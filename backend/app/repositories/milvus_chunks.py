"""Milvus Chunk 向量存储与检索。"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from pymilvus import MilvusClient

from app.domain.rag import PolicyStatus, RagQuery, RetrievalHit, SourceReference
from app.services.rag.embedding import BgeEmbeddingProvider, MODEL_DIMENSION


COLLECTION = "policy_chunks_v1"
OUTPUT_FIELDS = [
    "knowledge_base_id", "document_id", "version_id", "title", "text",
    "page_number", "article_number", "source_url", "policy_status",
    "effective_from_ts", "effective_to_ts",
]


class MilvusChunkRepository:
    """在存储层下推状态与时间过滤，返回领域检索结果。"""

    name = "vector"

    def __init__(self, uri: str, embedding: BgeEmbeddingProvider) -> None:
        self._client = MilvusClient(uri=uri)
        self._embedding = embedding

    def ensure_collection(self) -> None:
        if not self._client.has_collection(COLLECTION):
            self._client.create_collection(
                collection_name=COLLECTION,
                dimension=MODEL_DIMENSION,
                id_type="string",
                max_length=64,
                vector_field_name="vector",
                metric_type="COSINE",
                consistency_level="Strong",
            )

    def upsert(self, rows: list[dict]) -> None:
        if rows:
            self._client.upsert(collection_name=COLLECTION, data=rows)

    def delete_ids(self, ids: list[str]) -> None:
        if ids:
            self._client.delete(collection_name=COLLECTION, ids=ids)

    async def retrieve(self, query: RagQuery, limit: int) -> tuple[RetrievalHit, ...]:
        return await asyncio.to_thread(self._retrieve_sync, query, limit)

    def _retrieve_sync(self, query: RagQuery, limit: int) -> tuple[RetrievalHit, ...]:
        vector = self._embedding.embed_query(query.question)
        at = int(query.filters.effective_at.timestamp())
        statuses = ", ".join(
            f'"{status.value}"' for status in sorted(query.filters.allowed_statuses)
        )
        clauses = [
            f"policy_status in [{statuses}]",
            f"effective_from_ts <= {at}",
            f"effective_to_ts >= {at}",
        ]
        if query.filters.knowledge_base_ids:
            ids = ", ".join(f'"{self._escape(value)}"' for value in query.filters.knowledge_base_ids)
            clauses.append(f"knowledge_base_id in [{ids}]")
        results = self._client.search(
            collection_name=COLLECTION,
            data=[vector],
            filter=" and ".join(clauses),
            limit=limit,
            output_fields=OUTPUT_FIELDS,
            search_params={"metric_type": "COSINE", "params": {}},
        )
        hits = []
        for result in results[0]:
            row = result["entity"]
            source = SourceReference(
                knowledge_base_id=row["knowledge_base_id"],
                document_id=row["document_id"],
                version_id=row["version_id"],
                chunk_id=str(result["id"]),
                title=row["title"],
                page_number=row.get("page_number") or None,
                article_number=row.get("article_number") or None,
                source_url=row.get("source_url") or None,
                policy_status=PolicyStatus(row["policy_status"]),
                effective_from=self._from_timestamp(row["effective_from_ts"]),
                effective_to=self._from_timestamp(row["effective_to_ts"]),
            )
            hits.append(RetrievalHit(text=row["text"], source=source, raw_score=result["distance"]))
        return tuple(hits)

    @staticmethod
    def _escape(value: str) -> str:
        return value.replace("\\", "\\\\").replace('"', '\\"')

    @staticmethod
    def _from_timestamp(value: int) -> datetime | None:
        if value in (0, 253402300799):
            return None
        return datetime.fromtimestamp(value, UTC)
