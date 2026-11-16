"""页面 API 使用的持久化资源。"""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import DateTime, ForeignKey, JSON, String
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


def new_id():
    return str(uuid4())


class KnowledgeBase(Base):
    __tablename__ = "knowledge_bases"
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    description: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime)
    updated_at: Mapped[datetime] = mapped_column(DateTime)


class Favorite(Base):
    __tablename__ = "favorites"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    qa_id: Mapped[str] = mapped_column(ForeignKey("qa_history.id", ondelete="CASCADE"), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)


class QuestionFilters(Base):
    __tablename__ = "qa_request_filters"
    qa_id: Mapped[str] = mapped_column(ForeignKey("qa_history.id", ondelete="CASCADE"), primary_key=True)
    knowledge_base_ids: Mapped[list] = mapped_column(JSON)
    effective_at: Mapped[datetime] = mapped_column(DateTime)


class ImportTask(Base):
    __tablename__ = "document_import_tasks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    document_id: Mapped[str] = mapped_column(String(32), index=True)
    knowledge_base_id: Mapped[str] = mapped_column(String(64), index=True)
    file_name: Mapped[str] = mapped_column(String(255))
    size: Mapped[int]
    metadata_json: Mapped[dict] = mapped_column(JSON)
    created_by: Mapped[str] = mapped_column(String(36))
    state: Mapped[str] = mapped_column(String(16), index=True)
    attempt: Mapped[int]
    queued_at: Mapped[datetime] = mapped_column(DateTime)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)
    warnings: Mapped[list] = mapped_column(JSON, default=list)
    error: Mapped[str | None] = mapped_column(String(255))
