"""文档内容去重与导入互斥；不改变现有文档和分块表结构。"""

from contextlib import contextmanager
import hashlib

from sqlalchemy import delete, select, text

from app.core.database import session_factory
from app.repositories.document_models import ChunkRecord, DocumentRecord


class ImportInProgressError(RuntimeError):
    """同一知识库已有导入或清理任务。"""


@contextmanager
def knowledge_base_import_lock(knowledge_base_id: str):
    """MySQL 连接级锁覆盖检查与写入，避免并行任务重复入库。"""
    with session_factory()() as db:
        engine = db.get_bind()
    if engine.dialect.name != "mysql":
        # SQLite 仅供单进程测试；生产导入使用 MySQL。
        yield
        return
    key = "finrag:import:" + hashlib.sha256(knowledge_base_id.encode()).hexdigest()[:48]
    with engine.connect() as connection:
        if connection.scalar(text("SELECT GET_LOCK(:key, 0)"), {"key": key}) != 1:
            raise ImportInProgressError("该知识库已有导入或去重任务，请等待其完成后重试")
        try:
            yield
        finally:
            connection.execute(text("SELECT RELEASE_LOCK(:key)"), {"key": key})


def find_same_content(db, knowledge_base_id: str, file_hash: str):
    return db.scalar(
        select(DocumentRecord).where(
            DocumentRecord.knowledge_base_id == knowledge_base_id,
            DocumentRecord.file_hash == file_hash,
        ).order_by(DocumentRecord.updated_at, DocumentRecord.id)
    )


def remove_document_index(db, document: DocumentRecord, repository) -> None:
    """先删向量再删元数据；不删除 raw 文件，重复执行删除向量是安全的。"""
    ids = list(db.scalars(select(ChunkRecord.id).where(ChunkRecord.document_id == document.id)))
    repository.delete_ids(ids)
    db.execute(delete(ChunkRecord).where(ChunkRecord.document_id == document.id))
    db.delete(document)


def duplicate_groups(db, knowledge_base_id: str):
    groups = {}
    for document in db.scalars(
        select(DocumentRecord).where(DocumentRecord.knowledge_base_id == knowledge_base_id)
        .order_by(DocumentRecord.updated_at, DocumentRecord.id)
    ):
        groups.setdefault(document.file_hash, []).append(document)
    return [documents for documents in groups.values() if len(documents) > 1]
