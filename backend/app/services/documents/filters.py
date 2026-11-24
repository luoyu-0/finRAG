"""制度数据集的导入范围过滤。

财务报表、部门决算/预算属于机构内部管理材料，不是面向业务人员的制度条文，
默认不进入 RAG 索引。规则只匹配文件名，避免误伤《预算法》等制度正文。
"""

from __future__ import annotations

import re
from pathlib import Path

# 文件名中的财务报表特征。顺序不影响结果，命中任意一条即排除。
FINANCIAL_STATEMENT_PATTERNS = (
    re.compile(r"(?:部门|本级|总行本级|年度).{0,12}(?:决算|预算)"),
    re.compile(r"\d{4}\s*年.{0,8}(?:决算|预算)"),
    re.compile(r"(?:财务报表|决算表|预算表)"),
    re.compile(r"(?:资产负债表|利润表|现金流量表|所有者权益变动表)"),
    re.compile(r"审计报告"),
)
# 手工隔离目录：下划线或 excluded/quarantine 包名下的文件不参与导入。
IGNORED_DIR_NAMES = {"excluded", "quarantine"}


def exclusion_reason(relative_path: str) -> str | None:
    """返回排除原因；None 表示允许导入。"""
    name = Path(relative_path).stem
    for pattern in FINANCIAL_STATEMENT_PATTERNS:
        match = pattern.search(name)
        if match:
            return f"财务报表类文档（命中“{match.group(0)}”）"
    return None


def is_ignored_path(relative_path: str) -> bool:
    """跳过 ``_excluded``、``excluded`` 等人工隔离目录。"""
    parts = Path(relative_path).parts[:-1]
    return any(
        part.startswith("_") or part.lower() in IGNORED_DIR_NAMES
        for part in parts
    )
