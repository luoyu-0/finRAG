"""RAG 在线问答编排服务。"""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Sequence
from dataclasses import dataclass

from langchain_core.runnables import RunnableLambda

from app.domain.rag import (
    Citation,
    ContextPackage,
    EvidenceSupport,
    EvidenceSupportLevel,
    FusedHit,
    RagAnswer,
    RagQuery,
    RetrievalHit,
)
from app.repositories.retrieval import Retriever
from app.services.rag.context import ContextAssembler
from app.services.rag.errors import (
    GenerationContractError,
    GenerationFailedError,
    RagConfigurationError,
    RetrievalUnavailableError,
)
from app.services.rag.fusion import ReciprocalRankFusion
from app.services.rag.ports import AnswerGenerator, Reranker
from app.services.rag.scoring import RetrievalEvidenceScorer

logger = logging.getLogger(__name__)

# 正文中的引用标记，如 `[S1]`、`[S12]`。
CITATION_MARKER = re.compile(r"\[(S\d+)\]")
# 来源卡片展示的原文摘录长度上限，与前端卡片宽度匹配。
EXCERPT_LIMIT = 240


def _excerpt(text: str) -> str | None:
    """把分块正文压成单行摘录；空文本返回 None，由前端不展示引文段。"""

    compact = " ".join(text.split())
    if not compact:
        return None
    if len(compact) <= EXCERPT_LIMIT:
        return compact
    return f"{compact[:EXCERPT_LIMIT]}…"


@dataclass
class _RetrievedQuery:
    query: RagQuery
    results: dict[str, tuple[RetrievalHit, ...]]
    warnings: list[str]


@dataclass
class _PreparedQuery:
    query: RagQuery
    context: ContextPackage
    warnings: list[str]


class RagService:
    """协调检索、融合、上下文、生成和引用输出。"""

    def __init__(
        self,
        retrievers: Sequence[Retriever],
        generator: AnswerGenerator,
        *,
        fusion: ReciprocalRankFusion | None = None,
        reranker: Reranker | None = None,
        context_assembler: ContextAssembler | None = None,
        evidence_scorer: RetrievalEvidenceScorer | None = None,
        retrieval_multiplier: int = 2,
    ) -> None:
        if not retrievers:
            raise RagConfigurationError("至少需要一个检索器")
        names = [retriever.name for retriever in retrievers]
        if len(names) != len(set(names)):
            raise RagConfigurationError("检索器名称必须唯一")
        if retrieval_multiplier < 1:
            raise RagConfigurationError("retrieval_multiplier 必须大于 0")

        self._retrievers = tuple(retrievers)
        self._generator = generator
        self._fusion = fusion or ReciprocalRankFusion()
        self._reranker = reranker
        self._context_assembler = context_assembler or ContextAssembler()
        self._evidence_scorer = evidence_scorer or RetrievalEvidenceScorer()
        self._retrieval_multiplier = retrieval_multiplier
        self._chain = (
            RunnableLambda(self._retrieve_query, name="hybrid_retrieval")
            | RunnableLambda(self._prepare_context, name="fusion_and_context")
            | RunnableLambda(self._generate_answer, name="generation_and_citations")
        )

    async def answer(self, query: RagQuery) -> RagAnswer:
        """执行完整在线问答流程。"""

        return await self._chain.ainvoke(query)

    async def _retrieve_query(self, query: RagQuery) -> _RetrievedQuery:
        results, warnings = await self._retrieve(query)
        return _RetrievedQuery(query, results, warnings)

    async def _prepare_context(self, state: _RetrievedQuery) -> _PreparedQuery:
        query = state.query
        fused = self._fusion.fuse(state.results, limit=query.top_k * self._retrieval_multiplier)
        ranked, rerank_warning = await self._rerank(query, fused)
        warnings = list(state.warnings)
        if rerank_warning:
            warnings.append(rerank_warning)
        context = self._context_assembler.assemble(ranked[: query.top_k])
        return _PreparedQuery(query, context, warnings)

    async def _generate_answer(self, state: _PreparedQuery) -> RagAnswer:
        query, context, warnings = state.query, state.context, list(state.warnings)
        if not context.items:
            return self._no_evidence(warnings)

        try:
            generated = await self._generator.generate(query, context)
        except Exception as exc:  # Provider 异常统一转换，避免泄露实现细节。
            # 只记录异常类型，避免凭据、问题和制度正文进入日志。
            logger.warning(
                "RAG 生成失败：%s（原因：%s）",
                type(exc).__name__,
                type(exc.__cause__ or exc).__name__,
            )
            raise GenerationFailedError("回答生成失败") from exc

        answer = generated.answer.strip()
        if not answer:
            raise GenerationContractError("生成器返回了空回答")

        context_by_label = {item.label: item for item in context.items}
        # 正文里的行内标记与 citation_labels 取并集：模型只在内嵌标记里写引用、
        # 或只填 citation_labels 时，都能得到可定位的 citations（契约 §6）。
        labels = tuple(
            dict.fromkeys([*generated.citation_labels, *CITATION_MARKER.findall(answer)])
        )
        if not labels:
            return self._no_evidence(warnings)
        unknown_labels = [label for label in labels if label not in context_by_label]
        if unknown_labels:
            joined = ", ".join(unknown_labels)
            raise GenerationContractError(f"生成器引用了未知证据标签：{joined}")

        cited_items = tuple(context_by_label[label] for label in labels)
        citations = tuple(
            Citation(
                label=item.label,
                source=item.hit.source,
                excerpt=_excerpt(item.hit.text),
            )
            for item in cited_items
        )
        support = self._evidence_scorer.score(cited_items, len(self._retrievers))
        if context.truncated:
            warnings.append("生成上下文因预算限制被截断")

        return RagAnswer(
            answer=self._markdown_answer(answer),
            citations=citations,
            evidence_support=support,
            warnings=tuple(warnings),
        )

    def _no_evidence(self, warnings: list[str]) -> RagAnswer:
        return RagAnswer(
            answer="### 结论\n\n未在当前有效制度中检索到足够依据，暂无法回答该问题。",
            citations=(),
            evidence_support=EvidenceSupport(
                score=0.0,
                level=EvidenceSupportLevel.NONE,
                method=self._evidence_scorer.method,
                explanation="没有可用于回答的有效证据；该分数不是答案正确概率。",
            ),
            warnings=tuple(warnings),
        )

    @staticmethod
    def _markdown_answer(answer: str) -> str:
        if re.match(r"^#{1,6} +\S", answer):
            return answer
        return f"### 结论\n\n{answer}"

    async def _retrieve(
        self, query: RagQuery
    ) -> tuple[dict[str, tuple[RetrievalHit, ...]], list[str]]:
        limit = query.top_k * self._retrieval_multiplier
        outcomes = await asyncio.gather(
            *(retriever.retrieve(query, limit) for retriever in self._retrievers),
            return_exceptions=True,
        )

        results: dict[str, tuple[RetrievalHit, ...]] = {}
        warnings: list[str] = []
        for retriever, outcome in zip(self._retrievers, outcomes, strict=True):
            if isinstance(outcome, BaseException):
                warnings.append(f"检索通道 {retriever.name} 暂不可用")
                continue
            results[retriever.name] = tuple(
                hit for hit in outcome if query.filters.allows(hit.source)
            )

        if not results:
            raise RetrievalUnavailableError("所有检索通道均不可用")
        return results, warnings

    async def _rerank(
        self, query: RagQuery, hits: Sequence[FusedHit]
    ) -> tuple[tuple[FusedHit, ...], str | None]:
        if self._reranker is None:
            return tuple(hits[: query.top_k]), None
        try:
            reranked = await self._reranker.rerank(query, hits, query.top_k)
        except Exception:
            return tuple(hits[: query.top_k]), "重排服务暂不可用，已使用融合排名"
        return tuple(reranked[: query.top_k]), None
