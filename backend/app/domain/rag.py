"""RAG 在线问答核心领域对象。"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum


class PolicyStatus(StrEnum):
    """制度版本状态。"""

    ACTIVE = "active"
    INACTIVE = "inactive"
    UNKNOWN = "unknown"


class EvidenceSupportLevel(StrEnum):
    """当前证据对回答的支持等级，不表示答案正确概率。"""

    NONE = "none"
    WEAK = "weak"
    MODERATE = "moderate"
    STRONG = "strong"


@dataclass(frozen=True, slots=True)
class SourceReference:
    """能够定位到原制度内容的稳定来源信息。"""

    knowledge_base_id: str
    document_id: str
    version_id: str
    chunk_id: str
    title: str
    page_number: int | None = None
    article_number: str | None = None
    source_url: str | None = None
    policy_status: PolicyStatus = PolicyStatus.ACTIVE
    effective_from: datetime | None = None
    effective_to: datetime | None = None

    def __post_init__(self) -> None:
        required = (
            self.knowledge_base_id,
            self.document_id,
            self.version_id,
            self.chunk_id,
            self.title,
        )
        if any(not value.strip() for value in required):
            raise ValueError("来源的稳定 ID 和标题不能为空")
        if self.page_number is not None and self.page_number < 1:
            raise ValueError("页码必须大于 0")
        for value in (self.effective_from, self.effective_to):
            if value is not None and value.utcoffset() is None:
                raise ValueError("制度生效时间必须包含时区")
        if (
            self.effective_from is not None
            and self.effective_to is not None
            and self.effective_from > self.effective_to
        ):
            raise ValueError("制度失效时间不能早于生效时间")


@dataclass(frozen=True, slots=True)
class RetrievalFilters:
    """检索过滤条件。"""

    knowledge_base_ids: tuple[str, ...] = ()
    effective_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    allowed_statuses: frozenset[PolicyStatus] = field(
        default_factory=lambda: frozenset({PolicyStatus.ACTIVE})
    )

    def __post_init__(self) -> None:
        if any(not knowledge_base_id.strip() for knowledge_base_id in self.knowledge_base_ids):
            raise ValueError("知识库 ID 不能为空")
        if not self.allowed_statuses:
            raise ValueError("至少需要允许一种制度状态")
        if self.effective_at.utcoffset() is None:
            raise ValueError("检索时间必须包含时区")

    def allows(self, source: SourceReference) -> bool:
        """判断来源是否满足知识库、状态和生效时间条件。"""

        if self.knowledge_base_ids and source.knowledge_base_id not in self.knowledge_base_ids:
            return False
        if source.policy_status not in self.allowed_statuses:
            return False
        if source.effective_from is not None and self.effective_at < source.effective_from:
            return False
        if source.effective_to is not None and self.effective_at > source.effective_to:
            return False
        return True


@dataclass(frozen=True, slots=True)
class RagQuery:
    """进入 RAG 核心流程的标准查询。"""

    question: str
    filters: RetrievalFilters = field(default_factory=RetrievalFilters)
    top_k: int = 8

    def __post_init__(self) -> None:
        normalized = self.question.strip()
        if not normalized:
            raise ValueError("问题不能为空")
        if not 1 <= self.top_k <= 50:
            raise ValueError("top_k 必须在 1 到 50 之间")
        object.__setattr__(self, "question", normalized)


@dataclass(frozen=True, slots=True)
class RetrievalHit:
    """单个检索器返回的 Chunk。"""

    text: str
    source: SourceReference
    raw_score: float | None = None

    def __post_init__(self) -> None:
        normalized = self.text.strip()
        if not normalized:
            raise ValueError("检索结果正文不能为空")
        object.__setattr__(self, "text", normalized)


@dataclass(frozen=True, slots=True)
class FusedHit:
    """融合去重后的检索结果。"""

    text: str
    source: SourceReference
    relevance_score: float
    channels: tuple[str, ...]
    channel_ranks: tuple[tuple[str, int], ...]


@dataclass(frozen=True, slots=True)
class ContextItem:
    """提供给生成器的单条带标签证据。"""

    label: str
    hit: FusedHit
    rendered_text: str


@dataclass(frozen=True, slots=True)
class ContextPackage:
    """具有预算边界的生成上下文。"""

    text: str
    items: tuple[ContextItem, ...]
    truncated: bool = False


@dataclass(frozen=True, slots=True)
class GeneratorOutput:
    """生成 Provider 的结构化返回。"""

    answer: str
    citation_labels: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class Citation:
    """回答最终采用的来源。"""

    label: str
    source: SourceReference


@dataclass(frozen=True, slots=True)
class EvidenceSupport:
    """证据支持度。"""

    score: float
    level: EvidenceSupportLevel
    method: str
    explanation: str


@dataclass(frozen=True, slots=True)
class RagAnswer:
    """RAG 核心流程输出。"""

    answer: str
    citations: tuple[Citation, ...]
    evidence_support: EvidenceSupport
    warnings: tuple[str, ...] = ()
