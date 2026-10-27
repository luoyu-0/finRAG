"""MySQL 中文 ngram 关键词检索。"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.dialects.mysql import match

from app.core.database import session_factory
from app.domain.rag import PolicyStatus, RagQuery, RetrievalHit, SourceReference
from app.repositories.document_models import ChunkRecord, DocumentRecord


class KeywordChunkRetriever:
    """对分块正文执行全文检索并在 SQL 中过滤制度状态。"""

    name = "keyword"

    async def retrieve(self, query: RagQuery, limit: int) -> tuple[RetrievalHit, ...]:
        return await asyncio.to_thread(self._retrieve_sync, query, limit)

    def _retrieve_sync(self, query: RagQuery, limit: int) -> tuple[RetrievalHit, ...]:
        score = match(ChunkRecord.text, against=query.question).in_natural_language_mode()
        at = query.filters.effective_at.astimezone(UTC).replace(tzinfo=None)
        conditions = [
            DocumentRecord.policy_status.in_(tuple(status.value for status in query.filters.allowed_statuses)),
            or_(DocumentRecord.effective_from.is_(None), DocumentRecord.effective_from <= at),
            or_(DocumentRecord.effective_to.is_(None), DocumentRecord.effective_to >= at),
        ]
        if query.filters.knowledge_base_ids:
            conditions.append(DocumentRecord.knowledge_base_id.in_(query.filters.knowledge_base_ids))
        statement = (
            select(ChunkRecord, DocumentRecord, score.label("relevance"))
            .join(DocumentRecord, and_(
                ChunkRecord.document_id == DocumentRecord.id,
                ChunkRecord.version_id == DocumentRecord.version_id,
            ))
            .where(*conditions, score > 0)
            .order_by(score.desc())
            .limit(limit)
        )
        with session_factory()() as db:
            rows = db.execute(statement).all()
        hits = []
        for chunk, document, relevance in rows:
            source = SourceReference(
                knowledge_base_id=document.knowledge_base_id,
                document_id=document.id,
                version_id=document.version_id,
                chunk_id=chunk.id,
                title=document.title,
                page_number=chunk.page_number,
                article_number=chunk.article_number,
                source_url=document.source_url,
                policy_status=PolicyStatus(document.policy_status),
                effective_from=self._utc(document.effective_from),
                effective_to=self._utc(document.effective_to),
            )
            hits.append(RetrievalHit(text=chunk.text, source=source, raw_score=float(relevance)))
        return tuple(hits)

    @staticmethod
    def _utc(value: datetime | None) -> datetime | None:
        return value.replace(tzinfo=UTC) if value else None
