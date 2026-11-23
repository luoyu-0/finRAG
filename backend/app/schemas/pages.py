"""知识库、导入、历史与收藏的响应契约。"""

from datetime import datetime
from typing import Literal
from pydantic import BaseModel
from app.schemas.qa import CitationResponse, EvidenceSupportResponse


class Page[T](BaseModel):
    items: list[T]
    page: int
    page_size: int
    total: int
    has_next: bool


class BaseInfo(BaseModel):
    id: str
    name: str
    description: str | None
    document_count: int
    chunk_count: int
    created_at: datetime
    updated_at: datetime


class BaseStats(BaseModel):
    knowledge_base_id: str
    document_count: int
    version_count: int
    chunk_count: int
    active_version_count: int
    inactive_version_count: int
    embedded_chunk_count: int
    pending_chunk_count: int
    parse_warning_count: int
    last_ingested_at: datetime | None


class Version(BaseModel):
    id: str
    policy_status: str
    effective_from: datetime | None
    effective_to: datetime | None


class VersionDetail(Version):
    chunk_count: int
    parse_method: Literal["native", "ocr"]
    parse_warning_count: int
    created_at: datetime


class Document(BaseModel):
    id: str
    knowledge_base_id: str
    title: str
    file_name: str
    file_size: int
    page_count: int
    source_url: str | None
    tags: list[str]
    version_count: int
    current_version: Version | None
    created_at: datetime
    updated_at: datetime


class DocumentDetail(Document):
    versions: list[VersionDetail]


class ContentBlock(BaseModel):
    """按页重组的正文片段，供 PDF 等无法直接取全文的文档定位引用。"""

    chunk_id: str
    article_number: str | None
    page_number: int | None
    text: str


class ContentAnchor(BaseModel):
    """被引分块在文档正文中的位置。

    TXT 直接读原文件返回 `text`，`start`/`end` 是命中片段在原文中的字符区间；
    PDF 不能当文本渲染，改用 `blocks` 重组，此时只标记命中分块、不给字符区间。
    """

    chunk_id: str
    article_number: str | None
    page_number: int | None
    excerpt: str
    start: int | None
    end: int | None
    located: bool


class DocumentContent(BaseModel):
    id: str
    knowledge_base_id: str
    title: str
    file_name: str
    page_count: int
    policy_status: str
    source: Literal["txt", "pdf", "unavailable"]
    has_file: bool
    text: str | None
    blocks: list[ContentBlock]
    anchor: ContentAnchor | None


class DocumentFileTicket(BaseModel):
    url: str
    expires_in: int


class TaskError(BaseModel):
    error_code: str
    message: str


class Task(BaseModel):
    id: str
    document_id: str
    version_id: str | None
    state: str
    stage: str
    progress: float
    page_total: int
    page_processed: int
    attempt: int
    queued_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    warnings: list[str]
    error: TaskError | None
    created_by: str


class Upload(BaseModel):
    document: Document
    ingestion_task: Task


class History(BaseModel):
    id: str
    question: str
    answer: str
    citations: list[CitationResponse]
    evidence_support: EvidenceSupportResponse
    warnings: list[str]
    trace_id: str
    knowledge_base_ids: list[str]
    effective_at: datetime | None
    favorite_id: str | None
    favorited: bool
    created_at: datetime


class FavoriteSupport(BaseModel):
    score: float
    level: str


class FavoriteInfo(BaseModel):
    id: str
    qa_id: str
    question: str
    answer_excerpt: str
    # 收藏只存摘要，但页面要与问答页一致地渲染 Markdown 与行内角标，
    # 因此按 qa_id 联表带回原回答正文与引用（契约 §9.4）。
    answer: str
    citations: list[CitationResponse]
    evidence_support: FavoriteSupport
    citation_count: int
    created_at: datetime
