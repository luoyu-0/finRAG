"""RAG 在线核心流程单元测试。"""

from __future__ import annotations

import unittest
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from app.domain.rag import (
    EvidenceSupportLevel,
    GeneratorOutput,
    PolicyStatus,
    RagQuery,
    RetrievalFilters,
    RetrievalHit,
    SourceReference,
)
from app.services.rag.errors import (
    GenerationContractError,
    RetrievalUnavailableError,
)
from app.services.rag.fusion import ReciprocalRankFusion
from app.services.rag.orchestrator import RagService


def source(chunk_id: str, *, status: PolicyStatus = PolicyStatus.ACTIVE) -> SourceReference:
    return SourceReference(
        knowledge_base_id="kb-1",
        document_id="doc-1",
        version_id="version-1",
        chunk_id=chunk_id,
        title="流动性风险管理办法",
        page_number=2,
        article_number="第二条",
        policy_status=status,
    )


class StubRetriever:
    def __init__(
        self,
        name: str,
        hits: Sequence[RetrievalHit] = (),
        error: Exception | None = None,
    ) -> None:
        self.name = name
        self._hits = tuple(hits)
        self._error = error

    async def retrieve(self, query: RagQuery, limit: int) -> Sequence[RetrievalHit]:
        if self._error is not None:
            raise self._error
        return self._hits[:limit]


class StubGenerator:
    def __init__(self, output: GeneratorOutput) -> None:
        self.output = output
        self.calls = 0
        self.last_context = ""

    async def generate(self, query: RagQuery, context) -> GeneratorOutput:
        self.calls += 1
        self.last_context = context.text
        return self.output


class FailingReranker:
    async def rerank(self, query: RagQuery, hits, limit: int):
        raise RuntimeError("重排连接失败")


class ReciprocalRankFusionTests(unittest.TestCase):
    def test_merges_duplicate_chunks_and_records_channels(self) -> None:
        common = RetrievalHit(text="共同证据", source=source("chunk-1"))
        keyword_only = RetrievalHit(text="关键词证据", source=source("chunk-2"))

        fused = ReciprocalRankFusion(rank_constant=10).fuse(
            {"keyword": [common, keyword_only], "vector": [common]},
            limit=5,
        )

        self.assertEqual([item.source.chunk_id for item in fused], ["chunk-1", "chunk-2"])
        self.assertEqual(fused[0].channels, ("keyword", "vector"))
        self.assertGreater(fused[0].relevance_score, fused[1].relevance_score)


class RagServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_filters_inactive_sources_before_generation(self) -> None:
        active = RetrievalHit(text="有效制度证据", source=source("active"))
        inactive = RetrievalHit(
            text="已失效制度证据",
            source=source("inactive", status=PolicyStatus.INACTIVE),
        )
        generator = StubGenerator(GeneratorOutput("回答 [S1]", ("S1",)))
        service = RagService(
            [
                StubRetriever("keyword", [inactive, active]),
                StubRetriever("vector", [active]),
            ],
            generator,
        )

        answer = await service.answer(
            RagQuery(
                "如何管理流动性风险？",
                filters=RetrievalFilters(effective_at=datetime.now(UTC)),
            )
        )

        self.assertEqual(answer.citations[0].source.chunk_id, "active")
        self.assertNotIn("已失效制度证据", generator.last_context)
        self.assertEqual(answer.evidence_support.level, EvidenceSupportLevel.STRONG)

    async def test_does_not_call_generator_without_evidence(self) -> None:
        generator = StubGenerator(GeneratorOutput("不应生成", ()))
        service = RagService([StubRetriever("keyword")], generator)

        answer = await service.answer(RagQuery("没有依据的问题"))

        self.assertEqual(generator.calls, 0)
        self.assertEqual(answer.citations, ())
        self.assertEqual(answer.evidence_support.level, EvidenceSupportLevel.NONE)

    async def test_degrades_when_one_retriever_fails(self) -> None:
        hit = RetrievalHit(text="仍可使用的证据", source=source("chunk-1"))
        generator = StubGenerator(GeneratorOutput("回答 [S1]", ("S1",)))
        service = RagService(
            [
                StubRetriever("keyword", error=RuntimeError("连接失败")),
                StubRetriever("vector", [hit]),
            ],
            generator,
        )

        answer = await service.answer(RagQuery("测试降级"))

        self.assertEqual(len(answer.citations), 1)
        self.assertIn("检索通道 keyword 暂不可用", answer.warnings)
        self.assertEqual(answer.evidence_support.level, EvidenceSupportLevel.MODERATE)

    async def test_raises_when_all_retrievers_fail(self) -> None:
        service = RagService(
            [StubRetriever("keyword", error=RuntimeError("连接失败"))],
            StubGenerator(GeneratorOutput("回答", ())),
        )

        with self.assertRaises(RetrievalUnavailableError):
            await service.answer(RagQuery("测试全部失败"))

    async def test_rejects_unknown_citation_label(self) -> None:
        hit = RetrievalHit(text="有效证据", source=source("chunk-1"))
        service = RagService(
            [StubRetriever("keyword", [hit])],
            StubGenerator(GeneratorOutput("错误引用 [S9]", ("S9",))),
        )

        with self.assertRaises(GenerationContractError):
            await service.answer(RagQuery("测试越界引用"))

    async def test_rejects_answer_without_citation(self) -> None:
        hit = RetrievalHit(text="有效证据", source=source("chunk-1"))
        service = RagService(
            [StubRetriever("keyword", [hit])],
            StubGenerator(GeneratorOutput("没有引用的回答", ())),
        )

        with self.assertRaises(GenerationContractError):
            await service.answer(RagQuery("测试无引用回答"))

    async def test_falls_back_when_optional_reranker_fails(self) -> None:
        hit = RetrievalHit(text="融合结果证据", source=source("chunk-1"))
        service = RagService(
            [StubRetriever("keyword", [hit])],
            StubGenerator(GeneratorOutput("回答 [S1]", ("S1",))),
            reranker=FailingReranker(),
        )

        answer = await service.answer(RagQuery("测试重排降级"))

        self.assertEqual(answer.citations[0].source.chunk_id, "chunk-1")
        self.assertIn("重排服务暂不可用，已使用融合排名", answer.warnings)

    def test_rejects_naive_effective_time(self) -> None:
        with self.assertRaises(ValueError):
            RetrievalFilters(effective_at=datetime(2026, 10, 10))

    async def test_filters_wrong_knowledge_base_and_future_policy(self) -> None:
        now = datetime.now(UTC)
        wrong_knowledge_base = RetrievalHit(
            text="其他知识库内容",
            source=SourceReference(
                knowledge_base_id="kb-2",
                document_id="doc-2",
                version_id="version-2",
                chunk_id="wrong-kb",
                title="其他制度",
            ),
        )
        future_policy = RetrievalHit(
            text="尚未生效内容",
            source=SourceReference(
                knowledge_base_id="kb-1",
                document_id="doc-3",
                version_id="version-3",
                chunk_id="future",
                title="未来制度",
                effective_from=now + timedelta(days=1),
            ),
        )
        generator = StubGenerator(GeneratorOutput("不应生成", ()))
        service = RagService(
            [StubRetriever("keyword", [wrong_knowledge_base, future_policy])],
            generator,
        )

        answer = await service.answer(
            RagQuery(
                "查询当前制度",
                filters=RetrievalFilters(
                    knowledge_base_ids=("kb-1",),
                    effective_at=now,
                ),
            )
        )

        self.assertEqual(generator.calls, 0)
        self.assertEqual(answer.evidence_support.level, EvidenceSupportLevel.NONE)


if __name__ == "__main__":
    unittest.main()
