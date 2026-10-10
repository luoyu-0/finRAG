"""RAG 生成与重排端口。"""

from __future__ import annotations

from typing import Protocol, Sequence

from app.domain.rag import ContextPackage, FusedHit, GeneratorOutput, RagQuery


class Reranker(Protocol):
    """可选重排端口。"""

    async def rerank(
        self, query: RagQuery, hits: Sequence[FusedHit], limit: int
    ) -> Sequence[FusedHit]:
        """按相关性重新排序并限制结果数量。"""

        ...


class AnswerGenerator(Protocol):
    """LLM 生成端口。"""

    async def generate(self, query: RagQuery, context: ContextPackage) -> GeneratorOutput:
        """只基于给定上下文生成回答，并返回实际引用的标签。"""

        ...
