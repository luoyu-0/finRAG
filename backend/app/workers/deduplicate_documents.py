"""检查或清理已有重复内容索引，默认只预览。"""

import argparse
import os

from app.core.database import initialize_database, session_factory
from app.repositories.document_deduplication import (
    duplicate_groups, knowledge_base_import_lock, remove_document_index,
)
from app.repositories.milvus_chunks import MilvusChunkRepository
from app.services.rag.embedding import BgeEmbeddingProvider


def main() -> None:
    parser = argparse.ArgumentParser(description="按内容哈希清理同一知识库的重复索引")
    parser.add_argument("--knowledge-base-id", default="default")
    parser.add_argument("--apply", action="store_true", help="执行删除；raw 原文件保留")
    args = parser.parse_args()
    initialize_database()
    repository = None
    with knowledge_base_import_lock(args.knowledge_base_id), session_factory()() as db:
        groups = duplicate_groups(db, args.knowledge_base_id)
        if args.apply and groups:
            repository = MilvusChunkRepository(
                f"http://{os.getenv('MILVUS_HOST', 'milvus')}:{os.getenv('MILVUS_PORT', '19530')}",
                BgeEmbeddingProvider(),
            )
        removed = 0
        for keep, *copies in groups:
            print(f"保留 {keep.file_name}（{keep.id}）")
            for copy in copies:
                print(f"{'删除' if args.apply else '拟删除'} {copy.file_name}（{copy.id}）")
                if args.apply:
                    remove_document_index(db, copy, repository)
                removed += 1
            if args.apply:
                db.commit()
        print(f"{'已清理' if args.apply else '待清理'} {removed} 份重复索引；原文件未删除")


if __name__ == "__main__":
    main()
