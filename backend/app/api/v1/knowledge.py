"""知识库目录、导入健康度与文档查询。"""

import json
import re
from pathlib import Path
from typing import Literal
import jwt
from fastapi import APIRouter, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError
from app.api.v1.page_common import Admin, Db, Paging, User, now, paginate, utc
from app.core.exceptions import ApiError
from app.core.security import DOCUMENT_TICKET_TTL_SECONDS, create_document_ticket, decode_document_ticket
from app.repositories.document_models import ChunkRecord as Chunk, DocumentRecord as Doc
from app.repositories.page_models import KnowledgeBase as KB, ImportTask

from app.schemas.pages import (
    BaseInfo, BaseStats, CategoryCount, Document, DocumentContent, DocumentDetail, DocumentFileTicket, Page,
)

router = APIRouter(prefix="/api/v1", tags=["知识库与文档"])
RAW_ROOT = Path("/app/data/raw")
UPLOAD_ROOT = Path("/app/data/processed/uploads")
FILE_MEDIA_TYPES = {
    ".pdf": "application/pdf",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
}


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


def document_category(db):
    """在 SQL 中提取文件分类，兼容 MySQL 与测试使用的 SQLite。"""
    path = func.replace(Doc.file_name, "\\", "/")
    if db.get_bind().dialect.name == "sqlite":
        # 去掉末尾所有非分隔符字符后，余下长度就是 basename 的偏移。
        prefix = func.rtrim(path, func.replace(path, "/", ""))
        name = func.substr(path, func.length(prefix) + 1)
    else:
        name = func.substring_index(path, "/", -1)
    end = func.instr(name, ")_")
    category = func.substr(name, 2, end - 2)
    return case(
        ((func.substr(name, 1, 1) == "(") & (end > 2), category),
        else_="未分类",
    )


@router.get("/knowledge-bases/{key}/categories", response_model=Page[CategoryCount])
def list_categories(key: str, db: Db, user: User):
    required(db, KB, key, "KNOWLEDGE_BASE_NOT_FOUND")
    category = document_category(db)
    count = func.count(Doc.id)
    rows = db.execute(select(category.label("category"), count.label("document_count"))
                      .where(Doc.knowledge_base_id == key)
                      .group_by(category).order_by(count.desc(), category.asc()))
    items = [dict(row._mapping) for row in rows]
    return dict(items=items, page=1, page_size=len(items), total=len(items), has_next=False)


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
    path = RAW_ROOT / doc.file_name
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
                   policy_status: Literal["active", "inactive", "unknown"] | None = None, q: str = "",
                   sort: Literal["updated_at", "title", "category", "chunk_count"] = "updated_at",
                   order: Literal["asc", "desc"] = "desc", category: str | None = None,
                   format: Literal["txt", "pdf"] | None = None, has_warning: bool | None = None):
    stmt = select(Doc).where(Doc.title.icontains(q, autoescape=True))
    if knowledge_base_id:
        stmt = stmt.where(Doc.knowledge_base_id == knowledge_base_id)
    if policy_status:
        stmt = stmt.where(Doc.policy_status == policy_status)
    category_value = document_category(db)
    if category is not None:
        stmt = stmt.where(category_value == category)
    if format is not None:
        stmt = stmt.where(func.lower(Doc.file_name).endswith("." + format))
    if has_warning is not None:
        warnings = func.coalesce(func.nullif(func.trim(Doc.parse_warnings), ""), "[]")
        length = func.json_array_length if db.get_bind().dialect.name == "sqlite" else func.json_length
        stmt = stmt.where((length(warnings) > 0) == has_warning)
    sort_column = {"updated_at": Doc.updated_at, "title": Doc.title, "category": category_value}.get(sort)
    if sort == "chunk_count":
        counts = select(Chunk.document_id, func.count(Chunk.id).label("count")).group_by(Chunk.document_id).subquery()
        stmt = stmt.outerjoin(counts, counts.c.document_id == Doc.id)
        sort_column = func.coalesce(counts.c.count, 0)
    ordering = sort_column.asc() if order == "asc" else sort_column.desc()
    return paginate(db, stmt.order_by(ordering, Doc.id), paging, lambda doc: doc_view(db, doc))


@router.get("/documents/{key}", response_model=DocumentDetail)
def document_detail(key: str, db: Db, user: User):
    return doc_view(db, required(db, Doc, key, "DOCUMENT_NOT_FOUND"), True)


CN_DIGITS = {"零": 0, "〇": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
             "六": 6, "七": 7, "八": 8, "九": 9}


def _cn_number(value: str) -> int | None:
    """把条号里的中文或阿拉伯数字转成整数；无法解析时返回 None。"""
    if value.isdigit():
        return int(value)
    total, section = 0, 0
    for char in value:
        if char in CN_DIGITS:
            section = CN_DIGITS[char]
        elif char in {"十", "百", "千"}:
            unit = {"十": 10, "百": 100, "千": 1000}[char]
            total += (section or 1) * unit
            section = 0
        elif char == "万":
            total = (total + section) * 10000
            section = 0
        else:
            return None
    return total + section


def _article_ordinal(article: str | None) -> int:
    """条文排序键；无条号的分块排在页内最后。"""
    if not article:
        return 10**6
    match = re.search(r"第([零〇一二三四五六七八九十百千万0-9]+)条", article)
    if not match:
        return 10**6
    return _cn_number(match.group(1)) or 10**6


def _chunk_order(chunk) -> tuple[int, int, str]:
    return (chunk.page_number or 0, _article_ordinal(chunk.article_number), chunk.id)


def _document_path(doc) -> Path | None:
    """原文位置：命令行导入的文件在 data/raw 下，页面上传的文件在 uploads 任务目录。"""
    parts = Path(doc.file_name).parts
    candidates = [RAW_ROOT / doc.file_name, UPLOAD_ROOT.joinpath(*parts[1:]) if len(parts) > 1 else UPLOAD_ROOT]
    return next((candidate for candidate in candidates if candidate.is_file()), None)


def _locate_span(text: str, needle: str) -> tuple[int, int] | None:
    """在原文中定位分块文本，忽略空白差异，返回原文中的字符区间。"""
    def normalize(value: str) -> tuple[str, list[int]]:
        kept, positions = [], []
        for index, char in enumerate(value):
            if char.isspace():
                continue
            kept.append(char)
            positions.append(index)
        return "".join(kept), positions

    haystack, positions = normalize(text)
    target, _ = normalize(needle)
    if not target:
        return None
    # 整块定位失败时退化为前 40 个字符，避免重叠或清洗差异导致漏定位。
    for probe in (target, target[:40]):
        if not probe:
            continue
        found = haystack.find(probe)
        if found < 0:
            continue
        end = found + len(probe)
        if probe is target:
            # 分块可能包含条号前的章/节标题，命中时把起点收窄到「第X条」。
            marker = re.search(r"第[零〇一二三四五六七八九十百千万0-9]+条", target)
            if marker and marker.start() > 0:
                found += marker.start()
        return positions[found], positions[end - 1] + 1
    return None


@router.get("/documents/{key}/content", response_model=DocumentContent)
def document_content(key: str, db: Db, user: User, chunk_id: str | None = None):
    """读取文档正文；带 chunk_id 时返回被引分块在正文中的位置。"""
    doc = required(db, Doc, key, "DOCUMENT_NOT_FOUND")
    chunks = db.scalars(select(Chunk).where(Chunk.document_id == doc.id)).all()
    anchor_chunk = None
    if chunk_id:
        anchor_chunk = next((chunk for chunk in chunks if chunk.id == chunk_id), None)
        if anchor_chunk is None:
            raise ApiError(404, "CHUNK_NOT_FOUND", "引用的分块不存在或不属于该文档")

    path = _document_path(doc)
    text, blocks, source = None, [], "unavailable"
    if path is not None and path.suffix.lower() in {".txt", ".md"}:
        raw = path.read_bytes()
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = raw.decode("gb18030")
        source = "txt"
    elif chunks:
        blocks = [dict(chunk_id=chunk.id, article_number=chunk.article_number,
                       page_number=chunk.page_number, text=chunk.text)
                  for chunk in sorted(chunks, key=_chunk_order)]
        source = "pdf"

    anchor = None
    if anchor_chunk is not None:
        start = end = None
        located = source == "pdf"
        if text is not None:
            span = _locate_span(text, anchor_chunk.text)
            if span is not None:
                start, end = span
                located = True
        anchor = dict(chunk_id=anchor_chunk.id, article_number=anchor_chunk.article_number,
                      page_number=anchor_chunk.page_number, excerpt=anchor_chunk.text[:160],
                      start=start, end=end, located=located)

    return dict(id=doc.id, knowledge_base_id=doc.knowledge_base_id, title=doc.title,
                file_name=doc.file_name, page_count=doc.page_count, policy_status=doc.policy_status,
                source=source, has_file=path is not None, text=text, blocks=blocks, anchor=anchor)


@router.post("/documents/{key}/file-ticket", response_model=DocumentFileTicket)
def document_file_ticket(key: str, db: Db, user: User, response: Response) -> DocumentFileTicket:
    """签发原文短时访问链接（契约 §8.3.2）。

    浏览器的 PDF 阅读器不能附加 `Authorization` 头，前端因此先换一张 2 分钟有效的票据，
    再把票据 URL 交给 PDF 阅读器。票据只允许读取这一个文档。
    """
    doc = required(db, Doc, key, "DOCUMENT_NOT_FOUND")
    if _document_path(doc) is None:
        raise ApiError(404, "DOCUMENT_FILE_MISSING", "原文文件不在服务器上")
    token = create_document_ticket(user.id, doc.id)
    response.headers["Cache-Control"] = "no-store"
    return DocumentFileTicket(
        url=f"/api/v1/documents/{doc.id}/file?token={token}",
        expires_in=DOCUMENT_TICKET_TTL_SECONDS,
    )


@router.get("/documents/{key}/file", response_class=FileResponse)
def document_file(key: str, db: Db, token: str = ""):
    """按票据返回原文文件，供浏览器原生的 PDF 阅读器直接渲染。"""
    doc = required(db, Doc, key, "DOCUMENT_NOT_FOUND")
    try:
        permitted = decode_document_ticket(token)
    except jwt.InvalidTokenError as exc:
        raise ApiError(401, "AUTH_FILE_TICKET_INVALID", "原文链接已失效，请重新打开文档") from exc
    if permitted != doc.id:
        raise ApiError(403, "AUTH_FORBIDDEN", "当前用户无权读取该文档")
    path = _document_path(doc)
    if path is None:
        raise ApiError(404, "DOCUMENT_FILE_MISSING", "原文文件不在服务器上")
    return FileResponse(
        path,
        media_type=FILE_MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream"),
        filename=path.name,
        content_disposition_type="inline",
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
    )
