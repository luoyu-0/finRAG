"""文档及分块元数据；向量存于 Milvus。"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class DocumentRecord(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    knowledge_base_id: Mapped[str] = mapped_column(String(64), index=True)
    version_id: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(255))
    file_name: Mapped[str] = mapped_column(String(255))
    source_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    file_hash: Mapped[str] = mapped_column(String(64))
    policy_status: Mapped[str] = mapped_column(String(16), index=True)
    status_source: Mapped[str] = mapped_column(String(16))
    effective_from: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    effective_to: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    page_count: Mapped[int] = mapped_column(Integer)
    parse_warnings: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime)


class ChunkRecord(Base):
    __tablename__ = "document_chunks"
    __table_args__ = (
        Index("ix_document_chunks_document_version", "document_id", "version_id"),
        Index(
            "ix_document_chunks_text_ngram", "text",
            mysql_prefix="FULLTEXT", mysql_with_parser="ngram",
        ),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"))
    version_id: Mapped[str] = mapped_column(String(32))
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    article_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    text: Mapped[str] = mapped_column(Text)
