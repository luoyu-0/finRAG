"""知识库目录、导入健康度与文档查询。"""

import json
from pathlib import Path
from typing import Literal
from fastapi import APIRouter
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from app.api.v1.page_common import Admin, Db, Paging, User, now, paginate, utc
from app.core.exceptions import ApiError
from app.repositories.document_models import ChunkRecord as Chunk, DocumentRecord as Doc
from app.repositories.page_models import KnowledgeBase as KB, ImportTask

from app.schemas.pages import BaseInfo, BaseStats, Document, DocumentDetail, Page

router = APIRouter(prefix="/api/v1", tags=["知识库与文档"])
UPLOAD_ROOT = Path("/app/data/processed/uploads")


def sync_catalog(db):
    existing = set(db.scalars(select(KB.id)))
    groups = db.execute(select(Doc.knowledge_base_id, func.min(Doc.updated_at)).group_by(Doc.knowledge_base_id))
    for key, created in [*groups, ("default", now())]:
        if key not in existing:
            db.add(KB(id=key, name=key, created_at=created, updated_at=created))
            existing.add(key)
    db.commit()


def required(db, model, key, code):
    row = db.get(model, key)
    if row is None:
        raise ApiError(404, code, "资源不存在")
    return row


def stats(db, key):
    docs = db.execute(select(Doc.policy_status, Doc.updated_at, Doc.parse_warnings).where(Doc.knowledge_base_id == key)).all()
    chunks = db.scalar(select(func.count(Chunk.id)).join(Doc).where(Doc.knowledge_base_id == key))
    return dict(knowledge_base_id=key, document_count=len(docs), version_count=len(docs), chunk_count=chunks,
                active_version_count=sum(d.policy_status == "active" for d in docs),
                inactive_version_count=sum(d.policy_status == "inactive" for d in docs),
                embedded_chunk_count=chunks, pending_chunk_count=0,
                parse_warning_count=sum(len(json.loads(d.parse_warnings or "[]")) for d in docs),
                last_ingested_at=utc(max((d.updated_at for d in docs), default=None)))


def kb_view(db, kb):
    counts = stats(db, kb.id)
    return dict(id=kb.id, name=kb.name, description=kb.description, document_count=counts["document_count"],
                chunk_count=counts["chunk_count"], created_at=utc(kb.created_at),
                updated_at=max(utc(kb.updated_at), counts["last_ingested_at"] or utc(kb.updated_at)))


@router.get("/knowledge-bases", response_model=Page[BaseInfo])
def list_bases(db: Db, user: User, paging: Paging, q: str = ""):
    return paginate(db, select(KB).where(KB.name.contains(q, autoescape=True)).order_by(KB.id), paging, lambda kb: kb_view(db, kb))


@router.get("/knowledge-bases/{key}", response_model=BaseInfo)
def get_base(key: str, db: Db, user: User):
    return kb_view(db, required(db, KB, key, "KNOWLEDGE_BASE_NOT_FOUND"))


@router.get("/knowledge-bases/{key}/stats", response_model=BaseStats)
def get_stats(key: str, db: Db, user: User):
    required(db, KB, key, "KNOWLEDGE_BASE_NOT_FOUND")
    return stats(db, key)


class EditBase(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=500)


class CreateBase(EditBase):
    name: str = Field(min_length=1, max_length=80)


def save_base(db, kb):
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "KNOWLEDGE_BASE_NAME_CONFLICT", "知识库名称已存在")
    return kb_view(db, kb)


@router.post("/knowledge-bases", status_code=201, response_model=BaseInfo)
def create_base(payload: CreateBase, db: Db, admin: Admin):
    kb = KB(**payload.model_dump(), created_at=now(), updated_at=now())
    db.add(kb)
    return save_base(db, kb)


@router.patch("/knowledge-bases/{key}", response_model=BaseInfo)
def edit_base(key: str, payload: EditBase, db: Db, admin: Admin):
    kb = required(db, KB, key, "KNOWLEDGE_BASE_NOT_FOUND")
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "name" and value is None:
            raise ApiError(422, "VALIDATION_ERROR", "名称不能为空")
        setattr(kb, field, value)
    kb.updated_at = now()
    return save_base(db, kb)


def doc_view(db, doc, detail=False):
    parts = Path(doc.file_name).parts
    task = db.get(ImportTask, parts[1]) if len(parts) == 3 and parts[0] == "uploads" else None
    path = Path("/app/data/raw") / doc.file_name
    version = dict(id=doc.version_id, policy_status=doc.policy_status, effective_from=utc(doc.effective_from), effective_to=utc(doc.effective_to))
    active = doc.policy_status == "active" and (not doc.effective_from or doc.effective_from <= now()) and (not doc.effective_to or doc.effective_to >= now())
    result = dict(id=doc.id, knowledge_base_id=doc.knowledge_base_id, title=doc.title, file_name=task.file_name if task else doc.file_name,
                  file_size=task.size if task else (path.stat().st_size if path.is_file() else 0),
                  page_count=doc.page_count, source_url=doc.source_url, tags=task.metadata_json.get("tags", []) if task else [],
                  current_version=version if active else None, version_count=1, created_at=utc(task.queued_at if task else doc.updated_at), updated_at=utc(doc.updated_at))
    if detail:
        warnings = json.loads(doc.parse_warnings or "[]")
        result["versions"] = [dict(**version, chunk_count=db.scalar(select(func.count(Chunk.id)).where(Chunk.document_id == doc.id)),
                                   parse_method="ocr" if any("经 OCR" in w for w in warnings) else "native",
                                   parse_warning_count=len(warnings), created_at=utc(doc.updated_at))]
    return result


@router.get("/documents", response_model=Page[Document])
def list_documents(db: Db, user: User, paging: Paging, knowledge_base_id: str | None = None,
                   policy_status: Literal["active", "inactive", "unknown"] | None = None, q: str = ""):
    stmt = select(Doc).where(Doc.title.contains(q, autoescape=True))
    if knowledge_base_id:
        stmt = stmt.where(Doc.knowledge_base_id == knowledge_base_id)
    if policy_status:
        stmt = stmt.where(Doc.policy_status == policy_status)
    return paginate(db, stmt.order_by(Doc.updated_at.desc(), Doc.id), paging, lambda doc: doc_view(db, doc))


@router.get("/documents/{key}", response_model=DocumentDetail)
def document_detail(key: str, db: Db, user: User):
    return doc_view(db, required(db, Doc, key, "DOCUMENT_NOT_FOUND"), True)
