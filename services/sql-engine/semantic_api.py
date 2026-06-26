"""语义层 API（P0）：指标目录 + 按租户取值。

- GET /semantic/metrics            —— 指标/度量目录（治理单一真相，无需 DB）
- GET /semantic/metrics/values     —— 指定租户的指标取值（可用 names 逗号分隔筛选）

后续（P1）再加 POST /semantic/query（维度分组 + 时间粒度 + DSL 过滤的指标查询）。
"""
from collections import deque

from fastapi import APIRouter, HTTPException, Query

from semantic import SemanticService, SemanticError
from objects_api import _svc as _obj_svc      # 复用 ObjectAdminService 单例（get_detail / get_relations）
from kb_api import service as _kb_svc          # 复用 KbService 单例（按对象取关联文件）

router = APIRouter(prefix="/semantic", tags=["语义层"])
_svc = SemanticService()

_LABEL_FIELDS = ("name", "title", "segment_name", "product_name", "store_name",
                 "account_id", "one_id", "lead_id", "order_id", "id")


def _node_label(otype: str, oid: str, rec: dict | None) -> str:
    if rec:
        for f in _LABEL_FIELDS:
            if rec.get(f) not in (None, ""):
                return str(rec[f])
    return f"{otype}:{oid}"


def _entity_knowledge(tenant_id: int, otype: str, oid: str) -> list[dict]:
    try:
        files = _kb_svc.list_files(tenant_id, None, otype, oid, None, None)
        return [{"id": f["id"], "name": f["name"], "kind": f["kind"],
                 "in_context": bool(f.get("in_context"))} for f in files]
    except Exception:  # noqa: BLE001
        return []


def _build_chain(tenant_id: int, object_key: str, oid: str, max_hops: int, max_nodes: int) -> dict:
    """从实体出发 BFS 遍历关系图（正/反向），每节点挂关联知识 → 跨链图（nodes + edges）。"""
    nodes: dict[str, dict] = {}
    edges: list[dict] = []
    seen_edge: set[tuple] = set()
    q: deque = deque([(object_key, str(oid), 0)])
    queued = {f"{object_key}:{oid}"}

    while q and len(nodes) < max_nodes:
        otype, nid, hop = q.popleft()
        key = f"{otype}:{nid}"
        if key not in nodes:
            try:
                rec = _obj_svc.get_detail(tenant_id, otype, nid)
            except Exception:  # noqa: BLE001
                rec = None
            kn = _entity_knowledge(tenant_id, otype, nid)
            nodes[key] = {"key": key, "object": otype, "id": nid,
                          "label": _node_label(otype, nid, rec),
                          "hop": hop, "knowledge": kn, "knowledge_count": len(kn)}
        if hop >= max_hops:
            continue
        try:
            rels = _obj_svc.get_relations(tenant_id, otype, nid)
        except Exception:  # noqa: BLE001
            rels = {}
        for rel_type, items in (rels or {}).items():
            for it in items:
                ck = f"{it['object_key']}:{it['id']}"
                etag = (key, ck, rel_type)
                if etag not in seen_edge:
                    seen_edge.add(etag)
                    edges.append({"src": key, "dst": ck, "rel_type": rel_type,
                                  "direction": it.get("direction")})
                if ck not in queued and (len(nodes) + len(q)) < max_nodes:
                    queued.add(ck)
                    q.append((it["object_key"], str(it["id"]), hop + 1))

    kb_total = sum(n["knowledge_count"] for n in nodes.values())
    return {"start": f"{object_key}:{oid}", "max_hops": max_hops,
            "node_count": len(nodes), "edge_count": len(edges),
            "knowledge_total": kb_total,
            "nodes": list(nodes.values()), "edges": edges}


@router.get("/metrics", summary="指标目录（度量/指标定义）")
def metrics_catalog():
    return _svc.catalog()


@router.get("/metrics/values", summary="指标取值（按租户）")
def metrics_values(
    tenant_id: int = Query(..., description="租户 ID"),
    names: str | None = Query(None, description="逗号分隔的指标名，缺省取全部"),
):
    selected = [n.strip() for n in names.split(",") if n.strip()] if names else None
    try:
        return _svc.compute_metrics(tenant_id, selected)
    except SemanticError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/entity", summary="实体上下文包：结构化数据 + 关联对象 + 关联知识（Entity Hub）")
def entity_context(
    tenant_id: int = Query(..., description="租户 ID"),
    object: str = Query(..., description="对象类型，如 user / account / order"),
    id: str = Query(..., description="对象主键值"),
    include_knowledge: bool = Query(True, description="是否带上关联知识库文档"),
):
    """Entity Hub：把一个业务实体的「结构化数据(DB) + 关联对象 + 关联知识(KB)」组装成统一上下文包，供 Agent 归因/问答。"""
    try:
        detail = _obj_svc.get_detail(tenant_id, object, id)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e))
    if not detail:
        raise HTTPException(status_code=404, detail=f"未找到 {object}:{id}")
    try:
        relations = _obj_svc.get_relations(tenant_id, object, id)
    except Exception:  # noqa: BLE001
        relations = {}
    knowledge = []
    if include_knowledge:
        try:
            files = _kb_svc.list_files(tenant_id, None, object, id, None, None)
            knowledge = [{"id": f["id"], "name": f["name"], "kind": f["kind"],
                          "in_context": bool(f.get("in_context")),
                          "token_estimate": f.get("token_estimate"),
                          "description": f.get("description")} for f in files]
        except Exception:  # noqa: BLE001
            knowledge = []
    return {
        "object": object, "id": id,
        "data": detail,            # 结构化数据（DB 侧）
        "relations": relations,    # 关联对象（外键关系）
        "knowledge": knowledge,    # 关联知识（KB 侧，Entity Hub 对齐）
        "knowledge_count": len(knowledge),
    }


@router.get("/chain", summary="关系跨链：从实体多跳遍历关系图 + 每节点挂关联知识（归因链）")
def relation_chain(
    tenant_id: int = Query(..., description="租户 ID"),
    object: str = Query(..., description="起点对象类型"),
    id: str = Query(..., description="起点主键值"),
    max_hops: int = Query(3, ge=1, le=5, description="最大跳数"),
    max_nodes: int = Query(40, ge=1, le=200, description="节点数上限"),
):
    """Relationship Cross-linking：把 DB 外键关系合并为一张可遍历的图，沿途聚合知识库文档，
    形成「实体 → 关联实体 → … + 知识」的归因链，供 Agent 走链路分析。"""
    if not _obj_svc.get_detail(tenant_id, object, id):
        raise HTTPException(status_code=404, detail=f"未找到 {object}:{id}")
    return _build_chain(tenant_id, object, str(id), max_hops, max_nodes)


@router.get("/explain", summary="指标语义上下文：取值 + 口径 + 公式 + 关联知识")
def metric_explain(
    tenant_id: int = Query(..., description="租户 ID"),
    q: str = Query(..., description="指标名或中文（如 退款率 / gmv / 客单价）"),
):
    """数据×语义结合：返回一个指标的实时取值 + 业务口径(definition) + 计算公式 + 关联知识库文档。"""
    try:
        return _svc.explain(tenant_id, q)
    except SemanticError as e:
        raise HTTPException(status_code=400, detail=str(e))
