"""语义层 API（P0）：指标目录 + 按租户取值。

- GET /semantic/metrics            —— 指标/度量目录（治理单一真相，无需 DB）
- GET /semantic/metrics/values     —— 指定租户的指标取值（可用 names 逗号分隔筛选）

后续（P1）再加 POST /semantic/query（维度分组 + 时间粒度 + DSL 过滤的指标查询）。
"""
from fastapi import APIRouter, HTTPException, Query

from semantic import SemanticService, SemanticError

router = APIRouter(prefix="/semantic", tags=["语义层"])
_svc = SemanticService()


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
