"""SQL Engine 核心：模板加载 + 参数校验 + SQL 拼装"""

import re
from pathlib import Path
from typing import Any

import yaml

from executor import OlapExecutor

ALLOWED_PARAM_PATTERN = re.compile(r"^[a-zA-Z0-9_@.\-]+$")
MAX_LIMIT = 1000


class SqlEngine:
    def __init__(self, executor: OlapExecutor, templates_path: str | None = None):
        self.executor = executor
        path = templates_path or Path(__file__).parent / "templates" / "olap_queries.yaml"
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        self.templates: dict[str, dict] = data["templates"]

    def list_templates(self) -> list[dict]:
        return [
            {"name": name, "description": t["description"], "params": t["params"]}
            for name, t in self.templates.items()
        ]

    def query(self, template_name: str, params: dict[str, Any]) -> dict:
        if template_name not in self.templates:
            raise ValueError(f"Unknown template: {template_name}")

        tpl = self.templates[template_name]
        bound = self._bind_params(tpl["params"], params)
        sql = tpl["sql"].strip()

        import time
        start = time.perf_counter()
        rows = self.executor.execute(sql, bound)
        elapsed_ms = round((time.perf_counter() - start) * 1000, 2)

        return {
            "template": template_name,
            "params": bound,
            "row_count": len(rows),
            "elapsed_ms": elapsed_ms,
            "data": rows,
        }

    def _bind_params(self, required: list[str], provided: dict[str, Any]) -> dict[str, Any]:
        bound: dict[str, Any] = {}
        for key in required:
            if key not in provided:
                raise ValueError(f"Missing param: {key}")
            val = provided[key]
            self._validate_param(key, val)
            bound[key] = val

        if "limit" in bound:
            bound["limit"] = min(int(bound["limit"]), MAX_LIMIT)
        if "offset" in bound:
            bound["offset"] = max(int(bound["offset"]), 0)
        return bound

    def _validate_param(self, key: str, value: Any):
        if key in ("tenant_id", "one_id", "group_id", "limit", "offset"):
            int(value)  # raises if invalid
            return
        if key == "group_code" and isinstance(value, str):
            if not ALLOWED_PARAM_PATTERN.match(value):
                raise ValueError(f"Invalid param value for {key}")
            return
        if isinstance(value, str) and not ALLOWED_PARAM_PATTERN.match(value):
            raise ValueError(f"Invalid param value for {key}")
