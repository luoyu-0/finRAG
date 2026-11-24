"""预览或清理已入库的财务报表类索引；默认只预览，不删除 raw 原文件。"""

from __future__ import annotations

import argparse
import os

from sqlalchemy import select

from app.core.database import initialize_database, session_factory
from app.repositories.document_deduplication import knowledge_base_import_lock, remove_document_index
from app.repositories.document_models import DocumentRecord
from app.repositories.milvus_chunks import MilvusChunkRepository
from app.services.documents.filters import exclusion_reason
from app.services.rag.embedding import BgeEmbeddingProvider


def _reason(document: DocumentRecord) -> str | None:
    return exclusion_reason(document.file_name) or exclusion_reason(document.title)


def main() -> None:
    parser = argparse.ArgumentParser(description="清理已入库的财务报表类文档索引，默认只预览")
    parser.add_argument("--knowledge-base-id", default="default")
    parser.add_argument("--apply", action="store_true", help="执行删除；raw 原文件保留")
    args = parser.parse_args()

    initialize_database()
    with knowledge_base_import_lock(args.knowledge_base_id), session_factory()() as db:
        documents = list(db.scalars(
            select(DocumentRecord)
            .where(DocumentRecord.knowledge_base_id == args.knowledge_base_id)
            .order_by(DocumentRecord.file_name)
        ))
        targets = [(document, reason) for document in documents if (reason := _reason(document))]
        for document, reason in targets:
            print(f"{'删除' if args.apply else '拟删除'} {document.file_name}（{document.id}）：{reason}")
        if args.apply and targets:
            repository = MilvusChunkRepository(
                f"http://{os.getenv('MILVUS_HOST', 'milvus')}:{os.getenv('MILVUS_PORT', '19530')}",
                BgeEmbeddingProvider(),
            )
            for document, _ in targets:
                remove_document_index(db, document, repository)
            db.commit()
        print(
            f"{'已清理' if args.apply else '待清理'} {len(targets)} 份财务报表类索引；"
            f"raw 原文件未删除"
        )


if __name__ == "__main__":
    main()
