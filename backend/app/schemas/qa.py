"""RAG 问答接口 Schema。"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class QuestionRequest(BaseModel):
    """问答请求。"""

    question: str = Field(min_length=1, max_length=2_000)
    knowledge_base_ids: list[str] = Field(default_factory=list, max_length=20)
    effective_at: datetime | None = None
    top_k: int = Field(default=8, ge=1, le=50)

    @field_validator("question")
    @classmethod
    def normalize_question(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("问题不能为空")
        return normalized

    @field_validator("effective_at")
    @classmethod
    def require_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.utcoffset() is None:
            raise ValueError("effective_at 必须包含时区")
        return value

    @field_validator("knowledge_base_ids")
    @classmethod
    def require_knowledge_base_ids(cls, value: list[str]) -> list[str]:
        if any(not item.strip() for item in value):
            raise ValueError("知识库 ID 不能为空")
        return value


class CitationResponse(BaseModel):
    """来源引用。"""

    label: str
    document_id: str
    version_id: str
    chunk_id: str
    title: str
    page_number: int | None = None
    article_number: str | None = None
    source_url: str | None = None


class EvidenceSupportResponse(BaseModel):
    """非概率型证据支持度。"""

    score: float = Field(ge=0, le=1)
    level: Literal["none", "weak", "moderate", "strong"]
    method: str
    explanation: str


class QuestionResponse(BaseModel):
    """问答响应。"""

    answer: str
    citations: list[CitationResponse]
    evidence_support: EvidenceSupportResponse
    warnings: list[str]
    trace_id: str
