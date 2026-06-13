"""NL Segment 编排（文档 V3.0-06 Ch4 / CDP Agent Phase 1）

NL → cdp-agent → 候选 DSL → Filter/Query Engine 校验 + 回显 + 人数预估 → 用户确认 → 保存。

关键原则（文档红线）：
  - LLM 只做意图理解，不直接拼 SQL、不直接发规则。
  - 候选 DSL 必经 dsl_engine 校验 + estimate 才返回。
  - 模糊表达（如"近期活跃"未给定义）不强行猜测 → 返回澄清问题（多轮澄清）。
  - 可降级：无 DEEPSEEK_API_KEY 时走规则解析；规则命中即不调 LLM。
"""

import json
import os
import re
import uuid
from datetime import datetime, timedelta
from typing import Any

import httpx

from dsl import DslEngine
from objects import OBJECT_REGISTRY, ObjectError, ObjectService

CITIES = ["上海", "北京", "深圳", "杭州", "广州", "成都", "武汉", "南京"]
OBJ_KEYWORDS = {
    "lead": ["线索", "lead", "留资"],
    "account": ["账户", "account", "客户档案"],
    "product": ["商品", "product", "货品"],
    "store": ["门店", "store", "店铺"],
    "user": ["用户", "会员", "user", "客户"],
}
# 关系事件（落在 object_relations 边上，可带 create_time 时间窗）
TIME_WINDOW_RE = re.compile(r"(?:过去|最近|近)\s*(\d+)\s*(天|日|周|月)")
PURCHASE_KW = ("购买", "买过", "下单", "成交", "购")
VISIT_KW = ("访问", "到店", "到访", "光顾", "逛")
# 模糊表达：无明确定义时触发澄清（文档 Phase 1 多轮澄清）
VAGUE_TERMS = {
    "近期活跃": "「近期活跃」如何定义？例如：最近 N 天内有行为事件？",
    "最近活跃": "「最近活跃」如何定义？请给出时间窗口（如最近 7/30 天）。",
    "活跃用户": "「活跃」的判定标准是什么？（最近 N 天有行为 / 登录次数 ≥ K？）",
    "沉默": "「沉默」用户如何定义？（多少天无行为？）",
    "流失": "「流失」如何定义？（多少天未活跃？）",
}


class NlSegmentAgent:
    def __init__(self, dsl_engine: DslEngine, object_service: ObjectService):
        self.dsl = dsl_engine
        self.objects = object_service
        self.api_key = os.getenv("DEEPSEEK_API_KEY", "")
        self.api_base = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com").rstrip("/")
        self.model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
        self.llm_enabled = os.getenv("AGENT_LLM_ENABLED", "1") != "0"

    # ── draft：NL → 候选规则 + 解释 + 人数预估 / 澄清 ──────────────────────
    def draft(self, question: str, tenant_id: int, context: dict | None = None) -> dict:
        trace_id = "trc_" + uuid.uuid4().hex[:12]
        clar = self._vague_clarifications(question)
        if clar:
            return self._reply(question, tenant_id, trace_id, source="rule",
                               rule=None, clarifications=clar, confidence=0.0)

        # 1) 规则解析（确定性、无需 API）
        rule = self._rule_based(question, tenant_id)
        source = "rule"
        confidence = 0.9 if rule else 0.0
        reason = ""

        # 2) 规则未命中 → LLM 兜底
        if rule is None:
            if not (self.llm_enabled and self.api_key):
                return self._reply(question, tenant_id, trace_id, source="rule", rule=None,
                                   clarifications=["未能从问题中解析出可用筛选条件，请更具体描述对象与条件。"],
                                   confidence=0.0)
            llm = self._deepseek(question, tenant_id, context or {})
            if llm.get("clarifications"):
                return self._reply(question, tenant_id, trace_id, source="deepseek", rule=None,
                                   clarifications=llm["clarifications"], confidence=0.0)
            rule = llm.get("rule")
            source = "deepseek"
            confidence = float(llm.get("confidence", 0.6))
            reason = llm.get("reason", "")
            if not rule:
                return self._reply(question, tenant_id, trace_id, source="deepseek", rule=None,
                                   clarifications=["LLM 未能生成候选规则，请补充信息。"], confidence=0.0)

        rule["tenant_id"] = tenant_id

        # 3) 校验（候选 DSL 必经确定性校验）
        val = self.dsl.validate(rule)
        if not val["ok"]:
            return self._reply(question, tenant_id, trace_id, source=source, rule=rule,
                               clarifications=[f"候选规则校验未通过：{e}" for e in val["errors"]],
                               confidence=confidence, reason=reason)

        # 4) 回显 + 人数预估
        echo = self.dsl.echo(rule)
        est = self.dsl.estimate(rule)
        return self._reply(question, tenant_id, trace_id, source=source, rule=rule,
                           clarifications=[], confidence=confidence, reason=reason,
                           summary=echo["summary"], explanation=echo["conditions"],
                           estimate=est["estimate"], estimate_ms=est["elapsed_ms"])

    # ── 规则解析（确定性）─────────────────────────────────────────────────
    def _rule_based(self, question: str, tenant_id: int) -> dict | None:
        q = question.strip()
        obj = self._detect_object(q)
        conditions: list[dict] = []
        relations: list[dict] = []

        # 城市
        for city in CITIES:
            if city in q:
                conditions.append({"field": "city", "op": "eq", "value": city})
                break

        # 公司规模 > / >= N
        m = re.search(r"规模\s*(大于|超过|高于|多于|>=|>|不少于|不小于)\s*(\d+)", q)
        if m:
            op = "ge" if m.group(1) in ("不少于", "不小于", ">=") else "gt"
            conditions.append({"field": "company_size", "op": op, "value": int(m.group(2))})
        m = re.search(r"规模\s*(小于|少于|低于|<)\s*(\d+)", q)
        if m:
            conditions.append({"field": "company_size", "op": "lt", "value": int(m.group(2))})

        # 行业
        for kw, val in [("制造", "manufacturing"), ("科技", "tech"), ("零售", "retail"), ("金融", "finance")]:
            if kw in q and obj == "account":
                conditions.append({"field": "industry", "op": "eq", "value": val})
                break

        # 关联用户带 VIP / 高价值 标签
        if re.search(r"(关联|绑定|对应|名下).{0,4}用户", q) or "用户" in q:
            tag = None
            if re.search(r"vip", q, re.I):
                tag = "vip"
            elif "高价值" in q:
                tag = "high_value"
            if tag and obj != "user":
                relations.append({"rel_type": "belongs_to", "object": "user",
                                  "conditions": [{"field": "tags", "op": "contains", "value": tag}]})

        # base=user 时，标签直接作为 base 条件
        if obj == "user":
            if re.search(r"vip", q, re.I):
                conditions.append({"field": "tags", "op": "contains", "value": "vip"})
            elif "高价值" in q:
                conditions.append({"field": "tags", "op": "contains", "value": "high_value"})

        # 购买/访问事件（含"最近N天"→ 边条件 create_time 时间窗）
        event_rels = self._event_relations(q, obj)
        if event_rels:
            # 购买/访问主体只能挂在 user/account 上
            if obj not in ("user", "account"):
                obj = "user"
            relations.extend(event_rels)

        if not conditions and not relations:
            return None
        # 只有 base 是 user 且仅靠关联时，base 必须是能承载关联的对象
        return {"object": obj, "logic": "AND", "conditions": conditions, "relations": relations}

    def _event_relations(self, q: str, obj: str) -> list[dict]:
        """把"(最近N天)购买/访问"解析为关系链 + 边条件(create_time)。
        购买：user→owns→account→purchased→product（base=account 时直接 purchased）；访问：user→visited→store。
        时间窗用 create_time ge (今天-N天)，>= 写法天然含起始当天、规避 between 上界 00:00 漏当天。"""
        has_purchase = any(k in q for k in PURCHASE_KW)
        has_visit = any(k in q for k in VISIT_KW)
        if not (has_purchase or has_visit):
            return []
        edge: list[dict] = []
        m = TIME_WINDOW_RE.search(q)
        if m:
            days = int(m.group(1)) * {"周": 7, "月": 30}.get(m.group(2), 1)
            cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
            edge = [{"field": "create_time", "op": "ge", "value": cutoff}]
        if has_purchase:
            purchased = {"rel_type": "purchased", "object": "product"}
            if edge:
                purchased["edge_conditions"] = edge
            if obj == "account":
                return [purchased]
            return [{"rel_type": "owns", "object": "account", "relations": [purchased]}]
        # 访问门店
        visited = {"rel_type": "visited", "object": "store"}
        if edge:
            visited["edge_conditions"] = edge
        return [visited]

    def _detect_object(self, q: str) -> str:
        for otype, kws in OBJ_KEYWORDS.items():
            if otype == "user":
                continue
            if any(k in q for k in kws):
                return otype
        # 默认：提到"用户"且无其它对象 → user，否则 lead
        if any(k in q for k in OBJ_KEYWORDS["user"]):
            return "user"
        return "lead"

    def _vague_clarifications(self, question: str) -> list[str]:
        out = []
        for term, ask in VAGUE_TERMS.items():
            if term in question and not re.search(r"\d+\s*天", question):
                out.append(ask)
        return out

    # ── LLM 兜底 ──────────────────────────────────────────────────────────
    def _schema_brief(self) -> str:
        objs = self.objects.list_objects()
        rels = self.objects.relations()
        return json.dumps({"objects": objs, "relations": rels}, ensure_ascii=False)

    def _deepseek(self, question: str, tenant_id: int, context: dict) -> dict:
        today = datetime.now().strftime("%Y-%m-%d")
        system = f"""你是 CDP 圈人助手。把用户自然语言转成"候选 DSL Rule"，绝不直接写 SQL。

今天是 {today}。

可用对象与字段（schema）：
{self._schema_brief()}

关系进阶能力：
- 链式多跳：relations 可嵌套 relations，每跳 target 作为下一跳锚点（整棵树≤3 跳）。
  例「用户购买过商品」= user →owns→ account →purchased→ product（购买挂在 account 上，user 需 2 跳）。
- 边条件 edge_conditions：作用在**关系行**上（不是目标对象）。可用字段见每个关系的 `edge_fields`：
  通用 create_time（关系发生时间），以及该关系声明的 properties.<key>（如购买关系的 properties.channel）。
  **优先使用 edge_fields 中已声明的 properties 键名**，不要凭空编造；没有匹配键时才考虑 base/目标对象字段。
  用于"最近 N 天购买/访问""通过 app 渠道购买"这类**发生在关系上**的过滤。
  涉及"最近/过去 N 天"时：用 create_time op=ge value=(今天减 N 天)，>= 写法天然含当天、避免漏数据。

输出 JSON，二选一：
A) 能明确生成规则：
   {{"rule": {{"object":"lead","logic":"AND",
              "conditions":[{{"field":"city","op":"eq","value":"上海"}}],
              "relations":[{{"rel_type":"belongs_to","object":"user",
                            "conditions":[{{"field":"tags","op":"contains","value":"vip"}}]}}]}},
     "confidence":0.0~1.0, "reason":"简述"}}
   例（过去30天有过购买的用户）：
   {{"rule": {{"object":"user","logic":"AND","conditions":[],
              "relations":[{{"rel_type":"owns","object":"account",
                  "relations":[{{"rel_type":"purchased","object":"product",
                      "edge_conditions":[{{"field":"create_time","op":"ge","value":"<今天减30天>"}}]}}]}}]}},
     "confidence":0.85, "reason":"购买经 account，时间过滤放 purchased 的 edge_conditions"}}
B) 表达模糊（如"高价值""近期活跃"无明确定义）：
   {{"clarifications":["追问1","追问2"]}}

约束：
1. 对象字段（conditions）必须是 schema 真实字段；边字段（edge_conditions）仅 create_time / properties.<key>
2. op 仅限 eq/ne/gt/ge/lt/le/in/not_in/contains/between/like；标签类用 contains
3. relations 的 rel_type/object 必须在 schema relations 矩阵中；购买/访问时间务必放 edge_conditions 而非对象字段
4. 不确定就走 B 追问，不要编造字段或取值
5. 只输出 JSON"""
        user_msg = f"租户ID: {tenant_id}\n问题: {question}"
        if context:
            user_msg += f"\n上下文: {json.dumps(context, ensure_ascii=False)}"
        payload = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user_msg}],
            "response_format": {"type": "json_object"},
            "temperature": 0.1,
        }
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                f"{self.api_base}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                json=payload,
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
        return json.loads(content)

    # ── confirm：确认保存 ─────────────────────────────────────────────────
    def confirm(self, tenant_id: int, segment_code: str, segment_name: str, rule: dict,
                segment_service) -> dict:
        rule = {**rule, "tenant_id": tenant_id}
        val = self.dsl.validate(rule)
        if not val["ok"]:
            raise ObjectError("; ".join(val["errors"]))
        est = self.dsl.estimate(rule)
        clean = {k: v for k, v in rule.items() if k != "tenant_id"}
        return segment_service.save(tenant_id, segment_code, segment_name, clean,
                                    est["estimate"], source="nl-agent")

    # ── 组装响应 ──────────────────────────────────────────────────────────
    def _reply(self, question, tenant_id, trace_id, *, source, rule, clarifications,
               confidence, reason="", summary=None, explanation=None,
               estimate=None, estimate_ms=None) -> dict:
        return {
            "trace_id": trace_id,
            "question": question,
            "tenant_id": tenant_id,
            "source": source,
            "needs_clarification": bool(clarifications),
            "clarifications": clarifications,
            "rule": rule,
            "summary": summary,
            "explanation": explanation or [],
            "estimate": estimate,
            "estimate_ms": estimate_ms,
            "confidence": confidence,
            "reason": reason,
        }
