"""保守回填旧索引缺失条号，保留正文、向量和分块 ID；默认只预览。"""

import argparse
import os

from pymilvus import MilvusClient
from sqlalchemy import or_, select

from app.core.database import initialize_database, session_factory
from app.repositories.document_deduplication import knowledge_base_import_lock
from app.repositories.document_models import ChunkRecord, DocumentRecord
from app.repositories.milvus_chunks import COLLECTION
from app.services.documents.native_import import infer_single_article


def backfill(client, knowledge_base_id: str, *, apply: bool = False) -> int:
    count = 0
    with knowledge_base_import_lock(knowledge_base_id), session_factory()() as db:
        chunks = db.scalars(select(ChunkRecord).join(DocumentRecord, ChunkRecord.document_id == DocumentRecord.id).where(
            DocumentRecord.knowledge_base_id == knowledge_base_id,
            or_(ChunkRecord.article_number.is_(None), ChunkRecord.article_number == ""),
        )).all()
        for chunk in chunks:
            article = infer_single_article(chunk.text)
            if not article:
                continue
            if apply:
                rows = client.get(collection_name=COLLECTION, ids=[chunk.id], output_fields=["*", "vector"])
                if len(rows) != 1 or rows[0].get("text") != chunk.text or rows[0].get("version_id") != chunk.version_id or "vector" not in rows[0]:
                    raise ValueError(f"分块 {chunk.id} 的向量记录缺失或与 MySQL 不一致，已停止回填")
                row = rows[0]
                if row.get("article_number") not in (None, "", article):
                    raise ValueError(f"分块 {chunk.id} 的条号存在冲突，已停止回填")
                row["article_number"] = article
                client.upsert(collection_name=COLLECTION, data=[row])
                chunk.article_number = article
                db.commit()
            count += 1
        print(f"{'已回填' if apply else '可回填'} {count} 个分块条号；正文、向量与 ID 不变", flush=True)
    return count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--knowledge-base-id", default="default")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    initialize_database()
    client = MilvusClient(uri=f"http://{os.getenv('MILVUS_HOST', 'milvus')}:{os.getenv('MILVUS_PORT', '19530')}") if args.apply else None
    backfill(client, args.knowledge_base_id, apply=args.apply)


if __name__ == "__main__":
    main()
