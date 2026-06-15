"""Analyst：图表分析 + 自然语言（NL vibe）创建图表。

- 安全模型同 DSL：LLM 不写 SQL，只从**白名单数据源目录**里挑一个 source + 图表类型。
  数据源是后端定义的聚合（COUNT / GROUP BY 白名单字段），杜绝注入。
- 路由前缀 /analyst，经 nginx 暴露为 /api/analyst/*。
"""
from __future__ import annotations

import json
import os
import secrets
from contextlib import contextmanager

import httpx
import pymysql
from fastapi import APIRouter, Body, HTTPException, Query

from executor import MysqlOlapExecutor

CHART_TYPES = ("bar", "line", "pie", "area")

# 数据源目录：key → 计算方式。group 类 table/col 均为可信常量（非用户输入），安全。
SOURCES: dict[str, dict] = {
    "objects_count":    {"zh": "各对象数据量", "en": "Records per Object", "type": "bar", "kind": "objects"},
    "account_industry": {"zh": "客户行业分布", "en": "Accounts by Industry", "type": "pie", "kind": "group", "table": "object_account", "col": "industry"},
    "account_scale":    {"zh": "客户规模分布", "en": "Accounts by Scale", "type": "pie", "kind": "group", "table": "object_account", "col": "scale"},
    "order_status":     {"zh": "订单状态分布", "en": "Orders by Status", "type": "pie", "kind": "group", "table": "object_order", "col": "status"},
    "order_channel":    {"zh": "订单渠道分布", "en": "Orders by Channel", "type": "bar", "kind": "group", "table": "object_order", "col": "channel"},
    "lead_stage":       {"zh": "线索阶段分布", "en": "Leads by Stage", "type": "bar", "kind": "group", "table": "object_lead", "col": "stage"},
    "lead_city":        {"zh": "线索城市分布", "en": "Leads by City", "type": "bar", "kind": "group", "table": "object_lead", "col": "city"},
    "lead_source":      {"zh": "线索来源分布", "en": "Leads by Source", "type": "pie", "kind": "group", "table": "object_lead", "col": "source"},
    "product_category": {"zh": "商品类目分布", "en": "Products by Category", "type": "bar", "kind": "group", "table": "object_product", "col": "category"},
    "store_region":     {"zh": "门店区域分布", "en": "Stores by Region", "type": "bar", "kind": "group", "table": "object_store", "col": "region"},
}
_OBJECT_TABLES = [("user", "doris_user_wide"), ("lead", "object_lead"), ("account", "object_account"),
                  ("product", "object_product"), ("store", "object_store"), ("order", "object_order")]
_OBJECT_LABEL = {"user": "用户", "lead": "线索", "account": "客户", "product": "商品", "store": "门店", "order": "订单"}


class AnalystService:
    def __init__(self, executor: MysqlOlapExecutor | None = None):
        self._executor = executor or MysqlOlapExecutor()
        self.config = self._executor.config

    @contextmanager
    def _conn(self):
        conn = pymysql.connect(**self.config, autocommit=True)
        try:
            yield conn
        finally:
            conn.close()

    # ── 数据计算（白名单）────────────────────────────────────────────────────
    def data(self, tenant_id: int, source: str) -> list[dict]:
        meta = SOURCES.get(source)
        if not meta:
            raise HTTPException(status_code=400, detail=f"未知数据源：{source}")
        with self._conn() as conn, conn.cursor() as cur:
            if meta["kind"] == "objects":
                out = []
                for okey, table in _OBJECT_TABLES:
                    cur.execute(f"SELECT COUNT(*) AS c FROM {table} WHERE tenant_id=%s", (tenant_id,))
                    out.append({"label": _OBJECT_LABEL[okey], "value": int(cur.fetchone()["c"])})
                return out
            # group：table/col 为可信常量
            t, c = meta["table"], meta["col"]
            cur.execute(
                f"SELECT COALESCE({c}, '未知') AS label, COUNT(*) AS value "
                f"FROM {t} WHERE tenant_id=%s GROUP BY {c} ORDER BY value DESC LIMIT 12",
                (tenant_id,),
            )
            return [{"label": str(r["label"]), "value": int(r["value"])} for r in cur.fetchall()]

    # ── 下钻：某数据点背后的明细记录 ─────────────────────────────────────────
    def drilldown(self, tenant_id: int, source: str, label: str) -> dict:
        meta = SOURCES.get(source)
        if not meta:
            raise HTTPException(status_code=400, detail=f"未知数据源：{source}")
        with self._conn() as conn, conn.cursor() as cur:
            if meta["kind"] == "objects":
                rev = {v: k for k, v in _OBJECT_LABEL.items()}
                table = dict(_OBJECT_TABLES).get(rev.get(label, ""))
                if not table:
                    return {"columns": [], "rows": [], "count": 0}
                cur.execute(f"SELECT * FROM {table} WHERE tenant_id=%s LIMIT 200", (tenant_id,))
            else:
                t, c = meta["table"], meta["col"]
                if label in ("未知", "None", ""):
                    cur.execute(f"SELECT * FROM {t} WHERE tenant_id=%s AND ({c} IS NULL OR {c}='') LIMIT 200", (tenant_id,))
                else:
                    cur.execute(f"SELECT * FROM {t} WHERE tenant_id=%s AND {c}=%s LIMIT 200", (tenant_id, label))
            rows = cur.fetchall()
        # 隐藏冗长/内部列，JSON 列转字符串
        hide = {"tenant_id", "properties", "update_time"}
        cols = [k for k in (rows[0].keys() if rows else []) if k not in hide]
        out = []
        for r in rows:
            out.append({k: (str(r[k]) if r[k] is not None else "") for k in cols})
        return {"columns": cols, "rows": out, "count": len(out), "label": label}

    # ── KPI（看板用）─────────────────────────────────────────────────────────
    def kpis(self, tenant_id: int) -> dict:
        def one(sql: str) -> float:
            with self._conn() as conn, conn.cursor() as cur:
                cur.execute(sql, (tenant_id,))
                v = cur.fetchone()
                return float(list(v.values())[0] or 0) if v else 0.0
        users = int(one("SELECT COUNT(*) FROM doris_user_wide WHERE tenant_id=%s"))
        accounts = int(one("SELECT COUNT(*) FROM object_account WHERE tenant_id=%s"))
        leads = int(one("SELECT COUNT(*) FROM object_lead WHERE tenant_id=%s"))
        leads_q = int(one("SELECT COUNT(*) FROM object_lead WHERE tenant_id=%s AND stage='qualified'"))
        products = int(one("SELECT COUNT(*) FROM object_product WHERE tenant_id=%s"))
        stores = int(one("SELECT COUNT(*) FROM object_store WHERE tenant_id=%s"))
        orders = int(one("SELECT COUNT(*) FROM object_order WHERE tenant_id=%s"))
        orders_paid = int(one("SELECT COUNT(*) FROM object_order WHERE tenant_id=%s AND status='paid'"))
        gmv = one("SELECT COALESCE(SUM(amount),0) FROM object_order WHERE tenant_id=%s AND status='paid'")
        return {
            "users": users, "accounts": accounts, "leads": leads, "leads_qualified": leads_q,
            "products": products, "stores": stores, "orders": orders, "orders_paid": orders_paid,
            "gmv": round(gmv, 2), "aov": round(gmv / orders_paid, 2) if orders_paid else 0.0,
            "lead_qualified_rate": round(leads_q / leads, 4) if leads else 0.0,
            "order_paid_rate": round(orders_paid / orders, 4) if orders else 0.0,
        }

    # ── 图表 CRUD ────────────────────────────────────────────────────────────
    def list_charts(self, tenant_id: int) -> list[dict]:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, title, type, source FROM analyst_charts WHERE tenant_id=%s ORDER BY sort_order, created_at",
                (tenant_id,),
            )
            charts = cur.fetchall()
        for ch in charts:
            try:
                ch["data"] = self.data(tenant_id, ch["source"])
            except Exception:  # noqa: BLE001
                ch["data"] = []
        return charts

    def save_chart(self, tenant_id: int, title: str, ctype: str, source: str) -> dict:
        if source not in SOURCES:
            raise HTTPException(status_code=400, detail=f"未知数据源：{source}")
        ctype = ctype if ctype in CHART_TYPES else "bar"
        cid = "ch_" + secrets.token_hex(8)
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM analyst_charts WHERE tenant_id=%s", (tenant_id,))
            order = cur.fetchone()["n"]
            cur.execute(
                "INSERT INTO analyst_charts (id, tenant_id, title, type, source, sort_order) VALUES (%s,%s,%s,%s,%s,%s)",
                (cid, tenant_id, title, ctype, source, order),
            )
        return {"id": cid, "title": title, "type": ctype, "source": source, "data": self.data(tenant_id, source)}

    def delete_chart(self, tenant_id: int, cid: str) -> None:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM analyst_charts WHERE tenant_id=%s AND id=%s", (tenant_id, cid))

    # ── NL → 图表 spec（LLM 受限选择，失败降级关键词）───────────────────────
    def nl_chart(self, tenant_id: int, question: str) -> dict:
        spec = self._nl_llm(question) or self._nl_fallback(question)
        source = spec.get("source")
        if source not in SOURCES:
            source = "objects_count"
        ctype = spec.get("type") if spec.get("type") in CHART_TYPES else SOURCES[source]["type"]
        title = (spec.get("title") or SOURCES[source]["zh"]).strip()[:80]
        return {"title": title, "type": ctype, "source": source, "data": self.data(tenant_id, source)}

    def _nl_llm(self, question: str) -> dict | None:
        api_key = os.getenv("DEEPSEEK_API_KEY", "")
        if not api_key or os.getenv("AGENT_LLM_ENABLED", "1") == "0":
            return None
        catalog = "\n".join(f"- {k}: {v['zh']}" for k, v in SOURCES.items())
        system = (
            "你是图表助手。只能从给定数据源目录里选一个，绝不编造。"
            "返回 JSON：{\"title\":\"中文标题\",\"type\":\"bar|line|pie|area\",\"source\":\"目录里的key\"}。\n"
            f"数据源目录：\n{catalog}"
        )
        try:
            base = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com").rstrip("/")
            with httpx.Client(timeout=20.0, trust_env=False) as c:
                r = c.post(f"{base}/chat/completions",
                           headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                           json={"model": os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
                                 "messages": [{"role": "system", "content": system},
                                              {"role": "user", "content": question}],
                                 "response_format": {"type": "json_object"}, "temperature": 0.1})
                r.raise_for_status()
                return json.loads(r.json()["choices"][0]["message"]["content"])
        except Exception:  # noqa: BLE001
            return None

    @staticmethod
    def _nl_fallback(q: str) -> dict:
        ql = q.lower()
        kw = [("订单", "order_status"), ("渠道", "order_channel"), ("行业", "account_industry"),
              ("规模", "account_scale"), ("客户", "account_industry"), ("线索", "lead_stage"),
              ("阶段", "lead_stage"), ("城市", "lead_city"), ("来源", "lead_source"),
              ("商品", "product_category"), ("类目", "product_category"), ("门店", "store_region"),
              ("区域", "store_region"), ("对象", "objects_count")]
        source = next((s for w, s in kw if w in q), "objects_count")
        ctype = "pie" if any(w in q for w in ("占比", "比例", "分布")) else "bar"
        if "趋势" in q or "line" in ql:
            ctype = "line"
        return {"source": source, "type": ctype, "title": SOURCES[source]["zh"]}


service = AnalystService()
router = APIRouter(prefix="/analyst", tags=["analyst"])


@router.get("/sources")
def list_sources():
    return {"sources": [{"key": k, "title": v["zh"], "default_type": v["type"]} for k, v in SOURCES.items()],
            "types": list(CHART_TYPES)}


@router.get("/data")
def get_data(tenant_id: int = Query(...), source: str = Query(...)):
    return {"source": source, "data": service.data(tenant_id, source)}


@router.get("/drilldown")
def drilldown(tenant_id: int = Query(...), source: str = Query(...), label: str = Query(...)):
    return service.drilldown(tenant_id, source, label)


@router.get("/kpis")
def kpis(tenant_id: int = Query(...)):
    return service.kpis(tenant_id)


@router.get("/charts")
def list_charts(tenant_id: int = Query(...)):
    return {"charts": service.list_charts(tenant_id)}


@router.post("/charts")
def save_chart(tenant_id: int = Query(...), title: str = Body(...), type: str = Body("bar"), source: str = Body(...)):
    return service.save_chart(tenant_id, title, type, source)


@router.delete("/charts/{cid}")
def delete_chart(cid: str, tenant_id: int = Query(...)):
    service.delete_chart(tenant_id, cid)
    return {"ok": True}


@router.post("/charts/nl")
def nl_chart(tenant_id: int = Query(...), question: str = Body(..., embed=True)):
    return service.nl_chart(tenant_id, question)
