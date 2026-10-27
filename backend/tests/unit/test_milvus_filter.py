"""Milvus 检索过滤表达式测试。"""

import unittest

from app.domain.rag import RagQuery, RetrievalFilters
from app.repositories.milvus_chunks import MilvusChunkRepository


class FakeEmbedding:
    def embed_query(self, _question: str) -> list[float]:
        return [0.0] * 512


class FakeMilvus:
    def __init__(self) -> None:
        self.filter = ""

    def search(self, **kwargs):
        self.filter = kwargs["filter"]
        return [[]]


class MilvusFilterTests(unittest.TestCase):
    def test_pushes_status_and_knowledge_base_to_milvus(self) -> None:
        repository = object.__new__(MilvusChunkRepository)
        repository._embedding = FakeEmbedding()
        repository._client = FakeMilvus()
        query = RagQuery("流动性风险", filters=RetrievalFilters(knowledge_base_ids=("kb-1",)))
        self.assertEqual(repository._retrieve_sync(query, 3), ())
        self.assertIn('policy_status in ["active"]', repository._client.filter)
        self.assertIn('knowledge_base_id in ["kb-1"]', repository._client.filter)
        self.assertIn("effective_from_ts <=", repository._client.filter)
