"""将 data/raw 中的 TXT 与 PDF 导入 MySQL 和 Milvus。"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import delete, select

from app.core.database import initialize_database, session_factory
from app.repositories.document_models import ChunkRecord, DocumentRecord
from app.repositories.milvus_chunks import MilvusChunkRepository
from app.services.documents.native_import import parse_document
from app.services.ocr.ports import OCRProvider
from app.services.rag.embedding import BgeEmbeddingProvider


def _date(value: str | None) -> datetime | None:
    if value is None:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.utcoffset() is None:
        raise ValueError("生效时间必须包含时区")
    return parsed.astimezone(UTC)


def _chunk_ids(document_id: str, version_id: str, count: int) -> list[str]:
    return [
        hashlib.sha256(f"{document_id}:{version_id}:{index}".encode()).hexdigest()[:32]
        for index in range(count)
    ]


def import_file(
    path: Path, relative_path: str, knowledge_base_id: str,
    metadata: dict, repository: MilvusChunkRepository, embedding: BgeEmbeddingProvider,
    *, ocr: OCRProvider | None = None,
) -> tuple[int, tuple[str, ...]]:
    raw = path.read_bytes()
    if len(raw) > 50 * 1024 * 1024:
        raise ValueError("文件超过 50 MB 上限")
    file_hash = hashlib.sha256(raw).hexdigest()
    document_id = hashlib.sha256(f"{knowledge_base_id}:{relative_path}".encode()).hexdigest()[:32]
    version_id = hashlib.sha256(f"native-v1:{file_hash}".encode()).hexdigest()[:32]
    status = metadata.get("policy_status", "active")
    if status not in ("active", "inactive", "unknown"):
        raise ValueError("policy_status 必须为 active、inactive 或 unknown")
    effective_from = _date(metadata.get("effective_from"))
    effective_to = _date(metadata.get("effective_to"))
    if effective_from and effective_to and effective_from > effective_to:
        raise ValueError("生效截止时间不能早于开始时间")
    parsed = parse_document(path, ocr=ocr)
    title = metadata.get("title") or path.stem
    source_url = metadata.get("source_url")
    chunks = parsed.chunks
    ids = _chunk_ids(document_id, version_id, len(chunks))
    with session_factory()() as db:
        old_ids = list(db.scalars(select(ChunkRecord.id).where(ChunkRecord.document_id == document_id)))
        repository.delete_ids(old_ids)
        rows = []
        for offset in range(0, len(chunks), 32):
            batch = chunks[offset:offset + 32]
            vectors = embedding.embed_documents([chunk.text for chunk in batch])
            for index, (chunk, vector) in enumerate(zip(batch, vectors, strict=True), start=offset):
                rows.append({
                    "id": ids[index], "vector": vector, "knowledge_base_id": knowledge_base_id,
                    "document_id": document_id, "version_id": version_id, "title": title,
                    "text": chunk.text, "page_number": chunk.page_number or 0,
                    "article_number": chunk.article_number or "", "source_url": source_url or "",
                    "policy_status": status,
                    "effective_from_ts": int(effective_from.timestamp()) if effective_from else 0,
                    "effective_to_ts": int(effective_to.timestamp()) if effective_to else 253402300799,
                })
        for offset in range(0, len(rows), 100):
            repository.upsert(rows[offset:offset + 100])
        existing = db.get(DocumentRecord, document_id)
        if existing is None:
            existing = DocumentRecord(id=document_id)
            db.add(existing)
        existing.knowledge_base_id = knowledge_base_id
        existing.version_id = version_id
        existing.title = title
        existing.file_name = relative_path
        existing.file_hash = file_hash
        existing.source_url = source_url
        existing.policy_status = status
        existing.status_source = "provided" if "policy_status" in metadata else "default"
        existing.effective_from = effective_from.replace(tzinfo=None) if effective_from else None
        existing.effective_to = effective_to.replace(tzinfo=None) if effective_to else None
        existing.page_count = parsed.page_count
        existing.parse_warnings = json.dumps(parsed.warnings, ensure_ascii=False)
        existing.updated_at = datetime.now(UTC).replace(tzinfo=None)
        db.execute(delete(ChunkRecord).where(ChunkRecord.document_id == document_id))
        db.add_all(ChunkRecord(
            id=ids[index], document_id=document_id, version_id=version_id,
            page_number=chunk.page_number, article_number=chunk.article_number, text=chunk.text,
        ) for index, chunk in enumerate(chunks))
        db.commit()
    return len(chunks), parsed.warnings


def main() -> None:
    parser = argparse.ArgumentParser(description="导入 TXT 与 PDF 制度文件")
    parser.add_argument("--root", type=Path, default=Path("/app/data/raw"))
    parser.add_argument("--knowledge-base-id", default="default")
    parser.add_argument("--ocr", action="store_true", help="对无文字层的 PDF 页面使用 PaddleOCR")
    parser.add_argument("--paths-file", type=Path, help="只导入文件中列出的相对路径，每行一个")
    args = parser.parse_args()
    root = args.root.resolve()
    if not root.is_dir():
        parser.error(f"导入目录不存在：{root}")
    metadata_path = root / "metadata.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.exists() else {}
    if not isinstance(metadata, dict):
        parser.error("metadata.json 顶层必须是文件路径到元数据的对象")
    files = sorted(
        path for path in root.rglob("*")
        if path.is_file() and path.suffix.lower() in (".txt", ".pdf")
    )
    if args.paths_file:
        requested = [
            line.strip() for line in args.paths_file.read_text(encoding="utf-8-sig").splitlines()
            if line.strip()
        ]
        files = []
        for relative in requested:
            path = (root / relative).resolve()
            if (
                not path.is_relative_to(root) or not path.is_file()
                or path.suffix.lower() not in (".txt", ".pdf")
            ):
                parser.error(f"无效的导入路径：{relative}")
            files.append(path)
        files = sorted(set(files))
    if not files:
        parser.error("目录中没有 TXT 或 PDF 文件")
    initialize_database()
    embedding = BgeEmbeddingProvider()
    if args.ocr:
        from app.services.ocr.paddle import PaddleOCRProvider

        ocr: OCRProvider | None = PaddleOCRProvider()
    else:
        ocr = None
    repository = MilvusChunkRepository(
        f"http://{os.getenv('MILVUS_HOST', 'milvus')}:{os.getenv('MILVUS_PORT', '19530')}",
        embedding,
    )
    repository.ensure_collection()
    failed = 0
    for path in files:
        relative = path.relative_to(root).as_posix()
        try:
            count, warnings = import_file(
                path, relative, args.knowledge_base_id, metadata.get(relative, {}),
                repository, embedding, ocr=ocr,
            )
            print(f"已导入 {relative}：{count} 个分块")
            for warning in warnings:
                print(f"  告警：{warning}")
        except Exception as exc:
            failed += 1
            print(f"导入失败 {relative}：{exc}")
    if failed:
        raise SystemExit(f"{failed} 个文件导入失败")


if __name__ == "__main__":
    main()
