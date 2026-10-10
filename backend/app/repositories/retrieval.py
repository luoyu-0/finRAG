"""检索器抽象；具体关键词、Milvus 与 Embedding 实现由适配层提供。"""

from __future__ import annotations

from typing import Protocol, Sequence

from app.domain.rag import RagQuery, RetrievalHit


class Retriever(Protocol):
    """统一检索端口。"""

    name: str

    async def retrieve(self, query: RagQuery, limit: int) -> Sequence[RetrievalHit]:
        """返回已经按本通道相关性降序排列的结果。"""

        ...
