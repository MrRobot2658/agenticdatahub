"""DSL 验证层（文档 V3.0-06 Ch4.1–4.3：Filter/Query Engine 确定性能力本地代理）

DSL Rule（受控中间表示）：
  {
    "object": "lead",
    "logic": "AND",                       # base 条件组合逻辑
    "conditions": [ Leaf | Group ],        # Leaf={field,op,value}  Group={logic,conditions:[...]}
    "relations": [ {rel_type, object, direction, logic, conditions:[...]} ]
  }

能力：
  - validate：结构 + 字段/操作符/关联/跳数 校验（编译期）
  - echo    ：规则翻译成业务可读摘要 + 每条件解释（字段/操作符/取值）
  - compile ：DSL → SQL（不执行）
  - estimate：dry-run 人数预估（COUNT）

关键原则：LLM 不直接拼 SQL；候选 DSL 必经此层校验 + 预估才展示。
"""

from typing import Any

from objects import OBJECT_REGISTRY, RELATION_MATRIX, ObjectError, ObjectService

OP_LABEL = {
    "eq": "等于", "ne": "不等于", "gt": "大于", "ge": "不小于", "lt": "小于", "le": "不大于",
    "in": "属于", "not_in": "不属于", "contains": "包含", "between": "介于", "like": "匹配",
}
REL_LABEL = {"belongs_to": "归属于", "owns": "拥有", "purchased": "购买了", "visited": "访问过"}
OBJ_LABEL = {"user": "用户", "lead": "线索", "account": "账户", "product": "商品", "store": "门店"}


class DslEngine:
    def __init__(self, object_service: ObjectService | None = None):
        self.objects = object_service or ObjectService()

    # ── 校验 ──────────────────────────────────────────────────────────────
    def validate(self, rule: dict) -> dict:
        """结构与语义校验。返回 {ok, errors[]}，不抛异常。"""
        errors: list[str] = []
        obj = rule.get("object")
        if obj not in OBJECT_REGISTRY:
            return {"ok": False, "errors": [f"未知 base 对象: {obj}"]}
        tenant_id = rule.get("tenant_id", 0)
        try:
            # 借编译期校验：字段存在 / 操作符合法 / 关联定义 / 跳数 ≤3
            self.compile(rule, count_only=True)
        except ObjectError as e:
            errors.append(str(e))
        except Exception as e:  # noqa: BLE001
            errors.append(f"编译失败: {e}")
        return {"ok": not errors, "errors": errors}

    # ── 编译 ──────────────────────────────────────────────────────────────
    def compile(self, rule: dict, count_only: bool = False) -> dict:
        sql, params = self.objects.build_sql(
            rule.get("tenant_id", 0), rule["object"],
            rule.get("conditions"), rule.get("relations"),
            limit=int(rule.get("limit", 50)), count_only=count_only,
            logic=rule.get("logic", "AND"),
        )
        return {"sql": sql, "params": params}

    # ── 人数预估（dry-run）────────────────────────────────────────────────
    def estimate(self, rule: dict) -> dict:
        res = self.objects.search(
            rule.get("tenant_id", 0), rule["object"],
            rule.get("conditions"), rule.get("relations"),
            count_only=True, logic=rule.get("logic", "AND"),
        )
        return {"estimate": res["estimate"], "elapsed_ms": res["elapsed_ms"], "sql": res.get("sql")}

    # ── 翻译/回显 ─────────────────────────────────────────────────────────
    def echo(self, rule: dict) -> dict:
        obj = rule.get("object")
        if obj not in OBJECT_REGISTRY:
            raise ObjectError(f"未知 base 对象: {obj}")
        explanations: list[dict] = []
        base_summary = self._group_text(obj, rule.get("conditions"), rule.get("logic", "AND"), explanations)
        rel_summaries = [self._rel_text(obj, rel, explanations) for rel in (rule.get("relations") or [])]

        parts = [f"筛选{OBJ_LABEL.get(obj, obj)}"]
        if base_summary:
            parts.append(f"满足（{base_summary}）")
        if rel_summaries:
            parts.append("且 " + "，且 ".join(rel_summaries))
        return {"summary": "".join(parts), "conditions": explanations}

    def _rel_text(self, parent_type: str, rel: dict, explanations: list[dict]) -> str:
        """单条关系的中文摘要，递归展开链式多跳并描述边条件。"""
        tgt = rel.get("object")
        rel_type = rel.get("rel_type")
        if (parent_type, rel_type, tgt) not in RELATION_MATRIX and (tgt, rel_type, parent_type) not in RELATION_MATRIX:
            raise ObjectError(f"未定义的关联: {parent_type}-{rel_type}->{tgt}")
        inner = self._group_text(tgt, rel.get("conditions"), rel.get("logic", "AND"), explanations)
        edge = self._edge_text(rel.get("edge_conditions"))
        nested = [self._rel_text(tgt, r, explanations) for r in (rel.get("relations") or [])]
        quals = [x for x in (inner, edge) if x]
        quals.extend(nested)
        seg = f"其{REL_LABEL.get(rel_type, rel_type)}的{OBJ_LABEL.get(tgt, tgt)}"
        return seg + (f"满足（{'，且 '.join(quals)}）" if quals else "存在")

    def _edge_text(self, edge_conditions: list[dict] | None) -> str:
        """边条件中文描述（create_time → 发生时间）。"""
        parts = []
        for c in (edge_conditions or []):
            field = c.get("field")
            label = "发生时间" if field == "create_time" else field
            parts.append(f"{label} {OP_LABEL.get(c.get('op'), c.get('op'))} {c.get('value')}")
        return " 且 ".join(parts)

    def _group_text(self, object_type: str, items: list[dict] | None, logic: str,
                    explanations: list[dict]) -> str:
        meta = OBJECT_REGISTRY.get(object_type, {"fields": {}})
        parts = []
        for it in (items or []):
            is_group = "field" not in it and ("conditions" in it or "logic" in it)
            if is_group:
                sub = self._group_text(object_type, it.get("conditions"), it.get("logic", "AND"), explanations)
                if sub:
                    parts.append(f"（{sub}）")
                continue
            field, op, val = it.get("field"), it.get("op"), it.get("value")
            if field not in meta["fields"]:
                raise ObjectError(f"对象 {object_type} 无字段: {field}")
            op_label = OP_LABEL.get(op, op)
            text = f"{field} {op_label} {val}"
            parts.append(text)
            explanations.append({"object": object_type, "field": field, "op": op,
                                 "op_label": op_label, "value": val, "text": text})
        joiner = " 或 " if str(logic).upper() == "OR" else " 且 "
        return joiner.join(parts)
