"""持久化上传任务，按单个后台线程串行运行导入和 OCR。"""

import hashlib
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from typing import Annotated
from fastapi import APIRouter, File, Form, UploadFile
from sqlalchemy import select, update
from app.api.v1.knowledge import UPLOAD_ROOT, required
from app.api.v1.page_common import Admin, Db, Paging, now, paginate, utc
from app.core.database import session_factory
from app.core.exceptions import ApiError
from app.repositories.document_deduplication import ImportInProgressError, knowledge_base_import_lock, remove_document_index
from app.repositories.document_models import DocumentRecord
from app.repositories.page_models import ImportTask, KnowledgeBase
from app.repositories.milvus_chunks import MilvusChunkRepository
from app.services.rag.embedding import BgeEmbeddingProvider
from app.services.ocr.paddle import PaddleOCRProvider
from app.workers.import_documents import _import_file

from app.schemas.pages import BatchUpload, Page, Task, Upload

router = APIRouter(prefix="/api/v1", tags=["导入任务"])
executor = ThreadPoolExecutor(max_workers=1)
logger = logging.getLogger(__name__)
LIMIT = 50 * 1024 * 1024
BATCH_LIMIT = 48 * 1024 * 1024
BATCH_MAX_FILES = 20


def repository(embedding=None):
    return MilvusChunkRepository(f"http://{os.getenv('MILVUS_HOST', 'milvus')}:{os.getenv('MILVUS_PORT', '19530')}", embedding)


def task_view(db, task):
    doc = db.get(DocumentRecord, task.document_id) if task.state == "succeeded" else None
    return dict(id=task.id, document_id=task.document_id, version_id=doc.version_id if doc else None,
                state=task.state, stage={"processing": "extracting", "succeeded": "completed"}.get(task.state, "received"),
                progress=1 if task.state == "succeeded" else 0, page_total=doc.page_count if doc else 0,
                page_processed=doc.page_count if doc else 0, attempt=task.attempt, queued_at=utc(task.queued_at),
                started_at=utc(task.started_at), finished_at=utc(task.finished_at), warnings=task.warnings or [],
                error=dict(error_code="DOCUMENT_IMPORT_FAILED", message=task.error) if task.error else None, created_by=task.created_by)


def run_import(task_id):
    with session_factory()() as db:
        claimed = db.execute(update(ImportTask).where(ImportTask.id == task_id, ImportTask.state == "queued")
                             .values(state="processing", started_at=now())).rowcount
        db.commit()
        if not claimed:
            return
        task = db.get(ImportTask, task_id)
        path = UPLOAD_ROOT / task.id / task.file_name
        try:
            embedding = BgeEmbeddingProvider()
            repo = repository(embedding)
            repo.ensure_collection()
            with knowledge_base_import_lock(task.knowledge_base_id):
                document_id, _, warnings = _import_file(
                    path, f"uploads/{task.id}/{task.file_name}", task.knowledge_base_id,
                    task.metadata_json, repo, embedding, ocr=PaddleOCRProvider(),
                )
                # 索引在独立事务中提交，任务会话的 MySQL 快照可能看不到刚写入的文档。
                task.document_id = document_id
                task.warnings = list(warnings)
                task.state = "succeeded"
                task.finished_at = now()
                db.commit()
        except Exception as exc:
            db.rollback()
            logger.warning("文档导入失败 %s %s", task_id, type(exc).__name__)
            task.state = "failed"
            task.error = "文档解析或索引失败，请检查文件及索引服务后重试"
            task.finished_at = now()
            db.commit()


def recover_tasks(db):
    db.execute(update(ImportTask).where(ImportTask.state == "processing").values(
        state="failed", error="服务重启中断导入，可重试", finished_at=now()))
    db.commit()
    for task_id in db.scalars(select(ImportTask.id).where(ImportTask.state == "queued")):
        executor.submit(run_import, task_id)


def _validate_upload(file: UploadFile, title: str | None) -> tuple[str, str, int]:
    name = Path((file.filename or "").replace(chr(92), "/")).name
    if not name or len(name.encode()) > 255 or Path(name).suffix.lower() not in {
        ".pdf", ".txt", ".md", ".png", ".jpg", ".jpeg", ".docx",
    }:
        raise ApiError(415, "DOCUMENT_UNSUPPORTED_TYPE", "支持 TXT、Markdown、PDF、PNG、JPEG 和 DOCX")
    if file.size is None or not 0 < file.size <= LIMIT:
        raise ApiError(413, "DOCUMENT_TOO_LARGE", "文件必须非空且不超过 50 MB")
    display_title = (title or Path(name).stem).strip()
    if not display_title or len(display_title) > 255:
        raise ApiError(422, "VALIDATION_ERROR", "标题长度不符合要求")
    return name, display_title, file.size


def _upload_metadata(tags, effective_from, effective_to):
    tags = tags or []
    if len(tags) > 20 or any(len(tag) > 32 for tag in tags):
        raise ApiError(422, "VALIDATION_ERROR", "标签长度或数量不符合要求")
    metadata = {"tags": tags}
    dates = {}
    for field, raw in (("effective_from", effective_from), ("effective_to", effective_to)):
        if raw:
            try:
                value = datetime.fromisoformat(raw)
                if value.utcoffset() is None:
                    raise ValueError()
            except ValueError as exc:
                raise ApiError(422, "VALIDATION_ERROR", "日期必须包含时区") from exc
            dates[field] = value
            metadata[field] = value.isoformat()
    if len(dates) == 2 and dates["effective_from"] > dates["effective_to"]:
        raise ApiError(422, "VALIDATION_ERROR", "截止日期早于生效日期")
    return metadata


async def _enqueue_uploads(db: Db, admin: Admin, files: list[UploadFile], knowledge_base_id: str,
                           title: str | None, tags, effective_from, effective_to, *, total_limit: int):
    kb = required(db, KnowledgeBase, knowledge_base_id, "KNOWLEDGE_BASE_NOT_FOUND")
    kb_id = kb.id
    prepared = [_validate_upload(file, title) for file in files]
    if sum(size for _, _, size in prepared) > total_limit:
        raise ApiError(413, "DOCUMENT_TOO_LARGE", "批量上传的文件内容合计不得超过 48 MiB")
    metadata = _upload_metadata(tags, effective_from, effective_to)
    paths = []
    items = []
    try:
        for file, (name, display_title, size) in zip(files, prepared, strict=True):
            key = str(uuid4())
            path = UPLOAD_ROOT / key / name
            path.parent.mkdir(parents=True)
            paths.append(path)
            with path.open("xb") as out:
                while block := await file.read(1024 * 1024):
                    out.write(block)
            doc_id = hashlib.sha256(f"{kb_id}:uploads/{key}/{name}".encode()).hexdigest()[:32]
            task_metadata = dict(metadata, title=display_title) if title else dict(metadata)
            task = ImportTask(id=key, document_id=doc_id, knowledge_base_id=kb_id, file_name=name, size=size,
                              metadata_json=task_metadata, created_by=admin.id, state="queued", queued_at=now(), attempt=1)
            db.add(task)
            timestamp = utc(task.queued_at)
            items.append(dict(
                document=dict(id=doc_id, knowledge_base_id=kb_id, title=display_title, file_name=name,
                              file_size=size, page_count=0, source_url=None, tags=metadata["tags"],
                              version_count=0, current_version=None, created_at=timestamp, updated_at=timestamp),
                ingestion_task=task_view(db, task),
            ))
        db.commit()
    except BaseException:
        db.rollback()
        for path in reversed(paths):
            try:
                path.unlink(missing_ok=True)
                path.parent.rmdir()
            except OSError as exc:
                logger.warning("上传暂存清理失败 %s %s", path.parent.name, type(exc).__name__)
        raise
    for item in items:
        executor.submit(run_import, item["ingestion_task"]["id"])
    return items


@router.post("/documents", status_code=202, response_model=Upload)
async def upload(db: Db, admin: Admin, file: Annotated[UploadFile, File()],
                 knowledge_base_id: Annotated[str, Form()], title: Annotated[str | None, Form()] = None,
                 tags: Annotated[list[str] | None, Form()] = None,
                 effective_from: Annotated[str | None, Form()] = None, effective_to: Annotated[str | None, Form()] = None):
    items = await _enqueue_uploads(
        db, admin, [file], knowledge_base_id, title, tags, effective_from, effective_to, total_limit=LIMIT,
    )
    return items[0]


@router.post("/documents/batch", status_code=202, response_model=BatchUpload)
async def upload_batch(db: Db, admin: Admin, knowledge_base_id: Annotated[str, Form()],
                       files: Annotated[list[UploadFile], File(min_length=1, max_length=BATCH_MAX_FILES)],
                       tags: Annotated[list[str] | None, Form()] = None,
                       effective_from: Annotated[str | None, Form()] = None,
                       effective_to: Annotated[str | None, Form()] = None):
    items = await _enqueue_uploads(
        db, admin, files, knowledge_base_id, None, tags, effective_from, effective_to, total_limit=BATCH_LIMIT,
    )
    return {"items": items}


@router.get("/ingestion-tasks", response_model=Page[Task])
def list_tasks(db: Db, admin: Admin, paging: Paging, state: str | None = None, document_id: str | None = None):
    stmt = select(ImportTask)
    if state:
        stmt = stmt.where(ImportTask.state == state)
    if document_id:
        stmt = stmt.where(ImportTask.document_id == document_id)
    return paginate(db, stmt.order_by(ImportTask.queued_at.desc(), ImportTask.id), paging, lambda task: task_view(db, task))


@router.get("/ingestion-tasks/{key}", response_model=Task)
def get_task(key: str, db: Db, admin: Admin):
    return task_view(db, required(db, ImportTask, key, "INGESTION_TASK_NOT_FOUND"))


@router.post("/ingestion-tasks/{key}/retry", response_model=Task)
def retry(key: str, db: Db, admin: Admin):
    task = required(db, ImportTask, key, "INGESTION_TASK_NOT_FOUND")
    changed = db.execute(update(ImportTask).where(ImportTask.id == key, ImportTask.state == "failed").values(
        state="queued", queued_at=now(), attempt=ImportTask.attempt + 1, started_at=None, finished_at=None, error=None)).rowcount
    if not changed:
        raise ApiError(409, "INGESTION_TASK_STATE_CONFLICT", "仅失败任务可重试")
    db.commit()
    db.refresh(task)
    response = task_view(db, task)
    executor.submit(run_import, key)
    return response


@router.delete("/documents/{key}", status_code=204)
def delete_document(key: str, db: Db, admin: Admin):
    doc = required(db, DocumentRecord, key, "DOCUMENT_NOT_FOUND")
    try:
        with knowledge_base_import_lock(doc.knowledge_base_id):
            remove_document_index(db, doc, repository())
            db.commit()
    except ImportInProgressError:
        raise ApiError(409, "IMPORT_IN_PROGRESS", "知识库正在导入，请稍后重试")
