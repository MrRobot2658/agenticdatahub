"""OpenAPI / Swagger 数据模型"""

from typing import Any

from pydantic import BaseModel, Field


# ── 通用 ──────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    scale_tier: str
    doris_be_shards: int
    executor: dict
    nl_query: dict


class TemplateInfo(BaseModel):
    name: str
    description: str
    params: list[str]


class QueryRequest(BaseModel):
    params: dict = Field(default_factory=dict, examples=[{"tenant_id": 1001, "one_id": 100001}])


class QueryResult(BaseModel):
    template: str
    params: dict
    row_count: int
    elapsed_ms: float
    data: list[dict]


class NlQueryRequest(BaseModel):
    question: str = Field(..., examples=["查手机号13800138001的用户画像"])
    tenant_id: int = Field(..., examples=[1001])
    context: dict = Field(default_factory=dict)


class NlPlan(BaseModel):
    template: str
    params: dict
    source: str
    reason: str | None = None


class NlQueryResponse(BaseModel):
    question: str
    tenant_id: int
    plan: NlPlan
    result: QueryResult


# ── 用户分组 ──────────────────────────────────────────────────────────────

class GroupCreate(BaseModel):
    tenant_id: int
    group_code: str = Field(..., pattern=r"^[a-zA-Z0-9_\-]+$", examples=["vip_high_value"])
    group_name: str = Field(..., examples=["VIP高价值用户"])
    description: str | None = None
    group_type: str = Field(default="static", examples=["static", "dynamic"])
    filter_rule: dict | None = None


class GroupResponse(BaseModel):
    tenant_id: int
    group_id: int
    group_code: str
    group_name: str
    description: str | None = None
    group_type: str
    filter_rule: Any = None
    member_count: int
    created_at: Any = None
    updated_at: Any = None


class MemberAdd(BaseModel):
    one_id: int = Field(..., examples=[100001])
    source: str = Field(default="manual")


class MemberResponse(BaseModel):
    tenant_id: int
    group_id: int
    one_id: int
    added_at: Any = None
    source: str | None = None


class UserSummary(BaseModel):
    one_id: int
    phone: str | None = None
    wechat_openid: str | None = None
    tags: Any = None
    properties: Any = None
    groups: list[str] = Field(default_factory=list)


# ── 用户标签 ──────────────────────────────────────────────────────────────

class TagCreate(BaseModel):
    tenant_id: int = Field(..., examples=[1001])
    tag_code: str = Field(..., pattern=r"^[a-zA-Z0-9_\-]+$", examples=["new_tag"])
    tag_name: str = Field(..., examples=["新标签"])
    parent_id: int | None = Field(default=None, description="父标签 ID，空则为一级标签")
    description: str | None = None
    sort_order: int = Field(default=0)


class TagResponse(BaseModel):
    tag_id: int
    parent_id: int | None = None
    tag_code: str
    tag_name: str
    level: int
    tag_path: str
    description: str | None = None
    sort_order: int = 0
    children: list["TagResponse"] = Field(default_factory=list)


class TagSearchRequest(BaseModel):
    tenant_id: int = Field(..., examples=[1001])
    tag_codes: list[str] = Field(..., examples=[["high_value", "wechat_user"]])
    operator: str = Field(default="or", examples=["or", "and"])
    limit: int = Field(default=50, ge=1, le=200)


class UserImportRecord(BaseModel):
    channel_type: str = Field(..., examples=["phone"])
    channel_id: str = Field(..., examples=["13900001234"])
    link_keys: dict[str, str] = Field(default_factory=dict)
    properties: dict = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)


class UserImportRequest(BaseModel):
    tenant_id: int = Field(..., examples=[1001])
    records: list[UserImportRecord] = Field(..., min_length=1, max_length=500)


class GroupSearchRequest(BaseModel):
    tenant_id: int = Field(..., examples=[1001])
    group_ids: list[int] = Field(..., examples=[[1001, 1002]])
    operator: str = Field(default="or", examples=["or", "and"])
    limit: int = Field(default=50, ge=1, le=200)


# ── 多对象筛选（V3.0-06 第 3 章）────────────────────────────────────────────

class ObjectCondition(BaseModel):
    field: str = Field(..., examples=["city"])
    op: str = Field(..., examples=["eq", "gt", "in", "contains", "between", "like"])
    value: Any = Field(..., examples=["上海"])


class ObjectRelation(BaseModel):
    rel_type: str = Field(..., examples=["belongs_to"])
    object: str = Field(..., examples=["user"], description="关联目标对象类型")
    direction: str = Field(default="forward", examples=["forward", "reverse"])
    conditions: list[ObjectCondition] = Field(default_factory=list)
    # 边条件：作用在关系行(object_relations)上，字段为 create_time / properties.<key>
    edge_conditions: list[dict] = Field(
        default_factory=list,
        examples=[[{"field": "create_time", "op": "between",
                    "value": ["2026-05-14", "2026-06-13"]}]],
    )
    edge_logic: str = Field(default="AND")
    # 链式多跳：嵌套关系以当前 target 为下一跳锚点（user→account→product）
    relations: list["ObjectRelation"] = Field(default_factory=list)


ObjectRelation.model_rebuild()  # 解析自引用前向声明


class ObjectSearchRequest(BaseModel):
    tenant_id: int = Field(..., examples=[1001])
    object: str = Field(..., examples=["lead"], description="base 对象类型")
    conditions: list[ObjectCondition] = Field(
        default_factory=list,
        examples=[[{"field": "city", "op": "eq", "value": "上海"},
                   {"field": "company_size", "op": "gt", "value": 500}]],
    )
    relations: list[ObjectRelation] = Field(
        default_factory=list,
        examples=[[{"rel_type": "belongs_to", "object": "user",
                    "conditions": [{"field": "tags", "op": "contains", "value": "vip"}]}]],
    )
    limit: int = Field(default=50, ge=1, le=1000)
    count_only: bool = Field(default=False, description="只返回人数预估（COUNT）")


class ObjectUpsertRequest(BaseModel):
    tenant_id: int = Field(..., examples=[1001])
    object: str = Field(..., examples=["lead"])
    record: dict = Field(..., examples=[{"lead_id": "L9001", "city": "上海", "company_size": 600}])


class RelationAddRequest(BaseModel):
    tenant_id: int = Field(..., examples=[1001])
    src_type: str = Field(..., examples=["lead"])
    src_id: str = Field(..., examples=["L9001"])
    rel_type: str = Field(..., examples=["belongs_to"])
    dst_type: str = Field(..., examples=["user"])
    dst_id: str = Field(..., examples=["100002"])


# ── DSL 验证层（V3.0-06 Ch4.1–4.3）─────────────────────────────────────────

_DSL_EXAMPLE = {
    "tenant_id": 1001, "object": "lead", "logic": "AND",
    "conditions": [
        {"field": "city", "op": "eq", "value": "上海"},
        {"field": "company_size", "op": "gt", "value": 500},
    ],
    "relations": [
        {"rel_type": "belongs_to", "object": "user",
         "conditions": [{"field": "tags", "op": "contains", "value": "vip"}]},
    ],
}


class DslRule(BaseModel):
    """候选 DSL Rule。conditions 支持叶子 {field,op,value} 或嵌套组 {logic,conditions}。"""
    tenant_id: int = Field(..., examples=[1001])
    object: str = Field(..., examples=["lead"])
    logic: str = Field(default="AND", examples=["AND", "OR"])
    conditions: list[dict] = Field(default_factory=list)
    relations: list[dict] = Field(default_factory=list)
    limit: int = Field(default=50, ge=1, le=1000)

    model_config = {"json_schema_extra": {"examples": [_DSL_EXAMPLE]}}


class SegmentSaveRequest(BaseModel):
    tenant_id: int = Field(..., examples=[1001])
    segment_code: str = Field(..., pattern=r"^[a-zA-Z0-9_\-]+$", examples=["sh_vip_leads"])
    segment_name: str = Field(..., examples=["上海VIP关联线索"])
    dsl: dict = Field(..., examples=[_DSL_EXAMPLE])
    source: str = Field(default="manual", examples=["manual", "nl-agent"])


# ── NL Segment（Ch4 / CDP Agent Phase 1）──────────────────────────────────

class AgentDraftRequest(BaseModel):
    tenant_id: int = Field(..., examples=[1001])
    question: str = Field(..., examples=["地址在上海、公司规模大于500的线索，且关联用户带VIP标签"])
    context: dict = Field(default_factory=dict)


class AgentConfirmRequest(BaseModel):
    tenant_id: int = Field(..., examples=[1001])
    segment_code: str = Field(..., pattern=r"^[a-zA-Z0-9_\-]+$", examples=["sh_vip_leads"])
    segment_name: str = Field(..., examples=["上海VIP关联线索"])
    rule: dict = Field(..., examples=[_DSL_EXAMPLE])
