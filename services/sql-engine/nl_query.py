"""自然语义查询 — DeepSeek 意图识别 → 模板 + 参数 → SQL Engine 执行"""

import json
import os
import re
from typing import Any

import httpx

from engine import SqlEngine


class NlQueryPlanner:
    """将自然语言问题映射为已注册的 SQL 模板 + 参数（不生成自由 SQL）"""

    def __init__(self, engine: SqlEngine):
        self.engine = engine
        self.api_key = os.getenv("DEEPSEEK_API_KEY", "")
        self.api_base = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com").rstrip("/")
        self.model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

    def plan_and_query(self, question: str, tenant_id: int, context: dict | None = None) -> dict:
        plan = self._plan(question, tenant_id, context or {})
        result = self.engine.query(plan["template"], plan["params"])
        return {
            "question": question,
            "tenant_id": tenant_id,
            "plan": plan,
            "result": result,
        }

    def _plan(self, question: str, tenant_id: int, context: dict) -> dict:
        # 优先规则匹配（无 API 或简单句式）
        rule_plan = self._rule_based_plan(question, tenant_id)
        if rule_plan:
            rule_plan["source"] = "rule"
            return rule_plan

        if not self.api_key:
            raise ValueError("无法解析问题，且未配置 DEEPSEEK_API_KEY")

        llm_plan = self._deepseek_plan(question, tenant_id, context)
        llm_plan["source"] = "deepseek"
        return llm_plan

    def _rule_based_plan(self, question: str, tenant_id: int) -> dict | None:
        q = question.strip()

        m = re.search(r"(?:oneid|one_id|用户id|用户ID)\s*[=:]?\s*(\d+)", q, re.I)
        if m:
            return {"template": "profile_by_one_id", "params": {"tenant_id": tenant_id, "one_id": int(m.group(1))}}

        m = re.search(r"(?:手机|手机号|电话)\s*[=:]?\s*(1\d{10})", q)
        if m:
            return {"template": "profile_by_phone", "params": {"tenant_id": tenant_id, "phone": m.group(1)}}

        m = re.search(r"(?:表单|留资|form)\s*[=:_]?\s*([\w\-]+)", q, re.I)
        if m and "高价值" not in q:
            return {"template": "profile_by_form", "params": {"tenant_id": tenant_id, "form_id": m.group(1)}}

        # 分组相关（优先于 high_value，避免 vip_high_value 误匹配）
        if re.search(r"(所有分组|分组列表|有哪些分组|分组有哪些)", q):
            return {"template": "group_list", "params": {"tenant_id": tenant_id}}

        m = re.search(r"(?:分组|人群包|group)\s*[=:_]?\s*([a-zA-Z0-9_\-]+)", q, re.I)
        if m and re.search(r"(成员|用户|有哪些人|名单|多少人)", q):
            code = m.group(1)
            if code.isdigit():
                return {"template": "group_members", "params": {"tenant_id": tenant_id, "group_id": int(code)}}
            return {"template": "group_members_by_code", "params": {"tenant_id": tenant_id, "group_code": code}}

        m = re.search(r"(?:用户|oneid|one_id)\s*[=:]?\s*(\d+).*(?:哪些分组|属于.*分组|在哪些组)", q, re.I)
        if m:
            return {"template": "user_groups", "params": {"tenant_id": tenant_id, "one_id": int(m.group(1))}}

        m = re.search(r"(?:用户|oneid|one_id)\s*[=:]?\s*(\d+)", q, re.I)
        if m and re.search(r"分组", q):
            return {"template": "user_groups", "params": {"tenant_id": tenant_id, "one_id": int(m.group(1))}}

        if re.search(r"高价值|high_value", q, re.I):
            limit = 20
            lm = re.search(r"(?:前|top)\s*(\d+)", q, re.I)
            if lm:
                limit = int(lm.group(1))
            return {"template": "high_value_users", "params": {"tenant_id": tenant_id, "limit": limit}}

        if re.search(r"(列表|分页|最近更新)", q) and "分组" not in q and "标签" not in q:
            return {"template": "profile_list", "params": {"tenant_id": tenant_id, "limit": 20, "offset": 0}}

        # 标签相关
        if re.search(r"(所有标签|标签列表|有哪些标签|标签树)", q):
            return {"template": "tag_tree", "params": {"tenant_id": tenant_id}}

        m = re.search(r"(?:标签|tag)\s*[=:_]?\s*([a-zA-Z0-9_\-]+)", q, re.I)
        if m and re.search(r"(用户|有哪些人|名单|多少人|哪些人)", q):
            limit = 20
            lm = re.search(r"(?:前|top)\s*(\d+)", q, re.I)
            if lm:
                limit = int(lm.group(1))
            return {
                "template": "users_by_tag",
                "params": {"tenant_id": tenant_id, "tag_code": m.group(1), "limit": limit},
            }

        if re.search(r"(高价值用户|微信用户)", q) and "分组" not in q:
            tag = "high_value" if "高价值" in q else "wechat_user"
            return {"template": "users_by_tag", "params": {"tenant_id": tenant_id, "tag_code": tag, "limit": 20}}

        return None

    def _deepseek_plan(self, question: str, tenant_id: int, context: dict) -> dict:
        templates_desc = json.dumps(self.engine.list_templates(), ensure_ascii=False, indent=2)
        system = f"""你是 OLAP 查询助手。根据用户自然语言，从已有 SQL 模板中选择最合适的一个，并提取参数。

可用模板：
{templates_desc}

规则：
1. 只能返回 JSON，格式：{{"template": "模板名", "params": {{...}}, "reason": "简短说明"}}
2. template 必须是上述模板名之一，禁止编造
3. params 必须包含模板所需的全部参数
4. tenant_id 固定为 {tenant_id}，必须包含在 params 中
5. 不要生成自由 SQL，只做模板选择 + 参数提取
6. limit 默认 20，最大 1000"""

        user_msg = f"租户ID: {tenant_id}\n问题: {question}"
        if context:
            user_msg += f"\n附加上下文: {json.dumps(context, ensure_ascii=False)}"

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user_msg},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.1,
        }

        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                f"{self.api_base}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]

        parsed = json.loads(content)
        template = parsed.get("template")
        params = parsed.get("params", {})
        if not template:
            raise ValueError(f"DeepSeek 未返回有效模板: {content}")

        params["tenant_id"] = tenant_id
        return {
            "template": template,
            "params": params,
            "reason": parsed.get("reason", ""),
        }
