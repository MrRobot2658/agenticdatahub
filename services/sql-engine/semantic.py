"""语义层（P0：指标目录 + 取值）。原生扩展，复用 OBJECT_REGISTRY / OlapExecutor。

分层：
- Measure（度量）：单实体的原子聚合（count/count_distinct/sum/avg/min/max），可带结构化过滤。
- Metric（指标）：业务面向，组合度量——
    · simple  : 包装单个度量
    · ratio   : 分子度量 / 分母度量（除零安全）
    · derived : 由其它指标的表达式推导（P1 再支持）
- format：int / currency / percent，用于前端格式化与后端取整。

关键不变量（与 dsl.py 一致）：指标由注册表声明 → 编译为「参数化 SQL」→ 经 OlapExecutor 执行。
过滤条件是结构化 {field, op, value}，字段过 OBJECT_REGISTRY 白名单、值绑定为参数，
LLM / 用户绝不直接写 SQL，杜绝注入。
"""
from __future__ import annotations

from typing import Any

from executor import MysqlOlapExecutor, OlapExecutor
from objects import OBJECT_REGISTRY, SCALAR_OPS

AGG_NO_COLUMN = {"count"}                       # 不需要列的聚合
AGG_WITH_COLUMN = {"count_distinct", "sum", "avg", "min", "max"}

# ── 度量注册表（单实体原子聚合）─────────────────────────────────────────────
MEASURES: dict[str, dict] = {
    "user_count":           {"object": "user",    "agg": "count", "label": "用户数"},
    "account_count":        {"object": "account", "agg": "count", "label": "客户数"},
    "lead_count":           {"object": "lead",    "agg": "count", "label": "线索数"},
    "qualified_lead_count": {"object": "lead",    "agg": "count", "label": "合格线索数",
                             "filter": {"field": "stage", "op": "eq", "value": "qualified"}},
    "product_count":        {"object": "product", "agg": "count", "label": "产品数"},
    "store_count":          {"object": "store",   "agg": "count", "label": "门店数"},
    "order_count":          {"object": "order",   "agg": "count", "label": "订单数"},
    "paid_order_count":     {"object": "order",   "agg": "count", "label": "支付订单数",
                             "filter": {"field": "status", "op": "eq", "value": "paid"}},
    "gmv_amount":           {"object": "order",   "agg": "sum", "column": "amount", "label": "GMV",
                             "filter": {"field": "status", "op": "eq", "value": "paid"}},
}

# ── 指标注册表（业务面向，组合度量）─────────────────────────────────────────
METRICS: dict[str, dict] = {
    "users":               {"type": "simple", "measure": "user_count",           "label": "用户数",     "format": "int",      "object": "user"},
    "accounts":            {"type": "simple", "measure": "account_count",        "label": "客户数",     "format": "int",      "object": "account"},
    "leads":               {"type": "simple", "measure": "lead_count",           "label": "线索数",     "format": "int",      "object": "lead"},
    "leads_qualified":     {"type": "simple", "measure": "qualified_lead_count", "label": "合格线索数", "format": "int",      "object": "lead"},
    "products":            {"type": "simple", "measure": "product_count",        "label": "产品数",     "format": "int",      "object": "product"},
    "stores":              {"type": "simple", "measure": "store_count",          "label": "门店数",     "format": "int",      "object": "store"},
    "orders":              {"type": "simple", "measure": "order_count",          "label": "订单数",     "format": "int",      "object": "order"},
    "orders_paid":         {"type": "simple", "measure": "paid_order_count",     "label": "支付订单数", "format": "int",      "object": "order"},
    "gmv":                 {"type": "simple", "measure": "gmv_amount",           "label": "GMV",        "format": "currency", "object": "order"},
    "aov":                 {"type": "ratio",  "numerator": "gmv_amount",       "denominator": "paid_order_count", "label": "客单价 AOV",  "format": "currency", "object": "order"},
    "arpu":                {"type": "ratio",  "numerator": "gmv_amount",       "denominator": "user_count",       "label": "ARPU",        "format": "currency", "object": "user"},
    "lead_qualified_rate": {"type": "ratio",  "numerator": "qualified_lead_count", "denominator": "lead_count",   "label": "线索合格率",  "format": "percent",  "object": "lead"},
    "order_paid_rate":     {"type": "ratio",  "numerator": "paid_order_count", "denominator": "order_count",      "label": "订单支付率",  "format": "percent",  "object": "order"},
}


def _round(value: float, fmt: str) -> float | int:
    if fmt == "int":
        return int(round(value))
    if fmt == "percent":
        return round(value, 4)
    return round(value, 2)   # currency / 其它


class SemanticError(ValueError):
    pass


class SemanticService:
    def __init__(self, executor: OlapExecutor | None = None):
        self._executor = executor or MysqlOlapExecutor()

    # ── 编译：度量 → 参数化 SQL ────────────────────────────────────────────
    def _compile_measure(self, name: str) -> tuple[str, dict[str, Any]]:
        if name not in MEASURES:
            raise SemanticError(f"未知度量：{name}")
        m = MEASURES[name]
        obj = OBJECT_REGISTRY[m["object"]]
        table = obj["table"]
        fields = obj["fields"]
        agg = m["agg"]
        col = m.get("column")

        if agg in AGG_NO_COLUMN:
            expr = "COUNT(*)"
        elif agg in AGG_WITH_COLUMN:
            if not col or col not in fields:
                raise SemanticError(f"度量 {name} 的列 {col} 不在对象 {m['object']} 白名单内")
            fn = "COUNT(DISTINCT %s)" if agg == "count_distinct" else agg.upper() + "(%s)"
            expr = fn % f"`{col}`"
        else:
            raise SemanticError(f"度量 {name} 的聚合类型非法：{agg}")

        where = ["tenant_id = %(tenant_id)s"]
        params: dict[str, Any] = {}
        f = m.get("filter")
        if f:
            field, op = f["field"], f["op"]
            if field not in fields:
                raise SemanticError(f"度量 {name} 过滤字段 {field} 不在白名单内")
            if op not in SCALAR_OPS:
                raise SemanticError(f"度量 {name} 过滤操作符 {op} 非法")
            where.append(f"`{field}` {SCALAR_OPS[op]} %(fval)s")
            params["fval"] = f["value"]

        sql = f"SELECT COALESCE({expr}, 0) AS v FROM `{table}` WHERE " + " AND ".join(where)
        return sql, params

    # ── 计算 ──────────────────────────────────────────────────────────────
    def compute_measures(self, tenant_id: int, names: set[str]) -> dict[str, float]:
        out: dict[str, float] = {}
        for name in names:
            sql, params = self._compile_measure(name)
            params["tenant_id"] = tenant_id
            rows = self._executor.execute(sql, params)
            out[name] = float(rows[0]["v"]) if rows else 0.0
        return out

    def _measures_for(self, metric_names: list[str]) -> set[str]:
        needed: set[str] = set()
        for n in metric_names:
            spec = METRICS[n]
            if spec["type"] == "simple":
                needed.add(spec["measure"])
            elif spec["type"] == "ratio":
                needed.update([spec["numerator"], spec["denominator"]])
        return needed

    def compute_metrics(self, tenant_id: int, names: list[str] | None = None) -> dict[str, dict]:
        """返回 {metric: {value, label, format, type}}。"""
        names = names or list(METRICS)
        for n in names:
            if n not in METRICS:
                raise SemanticError(f"未知指标：{n}")
        mvals = self.compute_measures(tenant_id, self._measures_for(names))
        out: dict[str, dict] = {}
        for n in names:
            spec = METRICS[n]
            if spec["type"] == "simple":
                v = mvals[spec["measure"]]
            elif spec["type"] == "ratio":
                d = mvals[spec["denominator"]]
                v = (mvals[spec["numerator"]] / d) if d else 0.0
            else:
                raise SemanticError(f"指标 {n} 类型 {spec['type']} 暂不支持（P1）")
            out[n] = {"value": _round(v, spec["format"]), "label": spec["label"],
                      "format": spec["format"], "type": spec["type"]}
        return out

    def compute_values(self, tenant_id: int, names: list[str] | None = None) -> dict[str, float | int]:
        """仅取值 {metric: value}，供既有 KPI 接口复用。"""
        return {k: v["value"] for k, v in self.compute_metrics(tenant_id, names).items()}

    # ── 目录（无需 DB）─────────────────────────────────────────────────────
    def catalog(self) -> dict[str, Any]:
        def measure_brief(mname: str) -> dict:
            m = MEASURES[mname]
            return {"name": mname, "object": m["object"], "agg": m["agg"],
                    "column": m.get("column"), "filter": m.get("filter"), "label": m["label"]}

        metrics = []
        for name, spec in METRICS.items():
            if spec["type"] == "simple":
                used = [spec["measure"]]
            elif spec["type"] == "ratio":
                used = [spec["numerator"], spec["denominator"]]
            else:
                used = []
            metrics.append({
                "name": name, "label": spec["label"], "type": spec["type"],
                "format": spec["format"], "object": spec.get("object"),
                "measures": [measure_brief(u) for u in used],
            })
        return {
            "metrics": metrics,
            "measures": [measure_brief(n) for n in MEASURES],
            "objects": [{"key": k, "table": v["table"]} for k, v in OBJECT_REGISTRY.items()],
        }
