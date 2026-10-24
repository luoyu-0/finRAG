"""已鉴权的问答 HTTP 入口。"""

from datetime import UTC, datetime
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.v1.deps import current_user
from app.core.database import get_db
from app.core.exceptions import ApiError
from app.domain.rag import RagQuery, RetrievalFilters
from app.repositories.auth_models import QaRecord, UserRecord
from app.schemas.qa import QuestionRequest, QuestionResponse
from app.services.rag.errors import GenerationContractError, GenerationFailedError, RetrievalUnavailableError
from app.services.rag.orchestrator import RagService

router = APIRouter(prefix="/api/v1/qa", tags=["qa"])


def rag_service(request: Request) -> RagService:
    service = getattr(request.app.state, "rag_service", None)
    if service is None:
        raise ApiError(503, "RAG_RETRIEVAL_UNAVAILABLE", "检索服务尚未接入")
    return service


@router.post("/answer", response_model=QuestionResponse)
async def answer_route(
    payload: QuestionRequest,
    user: Annotated[UserRecord, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
    service: Annotated[RagService, Depends(rag_service)],
) -> QuestionResponse:
    query = RagQuery(
        question=payload.question,
        filters=RetrievalFilters(
            knowledge_base_ids=tuple(payload.knowledge_base_ids),
            effective_at=payload.effective_at or datetime.now(UTC),
        ),
        top_k=payload.top_k,
    )
    try:
        result = await service.answer(query)
    except RetrievalUnavailableError as exc:
        raise ApiError(503, "RAG_RETRIEVAL_UNAVAILABLE", "检索服务暂不可用") from exc
    except (GenerationFailedError, GenerationContractError) as exc:
        raise ApiError(502, "RAG_GENERATION_FAILED", "回答生成失败") from exc
    trace_id = str(uuid4())
    response = QuestionResponse.model_validate({
        "answer": result.answer,
        "citations": [
            {"label": item.label, "document_id": item.source.document_id,
             "version_id": item.source.version_id, "chunk_id": item.source.chunk_id,
             "title": item.source.title, "page_number": item.source.page_number,
             "article_number": item.source.article_number, "source_url": item.source.source_url}
            for item in result.citations
        ],
        "evidence_support": {
            "score": result.evidence_support.score,
            "level": result.evidence_support.level.value,
            "method": result.evidence_support.method,
            "explanation": result.evidence_support.explanation,
        },
        "warnings": list(result.warnings), "trace_id": trace_id,
    })
    db.add(QaRecord(
        id=str(uuid4()), user_id=user.id, question=query.question, answer=response.answer,
        citations=[item.model_dump() for item in response.citations],
        evidence_support=response.evidence_support.model_dump(), warnings=response.warnings,
        trace_id=trace_id, created_at=datetime.now(UTC).replace(tzinfo=None),
    ))
    db.commit()
    return response
