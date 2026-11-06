"""已鉴权的问答 HTTP 入口。"""

from datetime import UTC, datetime
import asyncio
import json
import logging
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.v1.deps import current_user
from app.core.database import get_db
from app.core.exceptions import ApiError
from app.domain.rag import RagAnswer, RagQuery, RetrievalFilters
from app.repositories.auth_models import QaRecord, UserRecord
from app.schemas.qa import QuestionRequest, QuestionResponse
from app.services.rag.errors import GenerationContractError, GenerationFailedError, RetrievalUnavailableError
from app.services.rag.orchestrator import RagService

router = APIRouter(prefix="/api/v1/qa", tags=["qa"])
logger = logging.getLogger(__name__)


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
    return _save_answer(result, query, user, db)


def _save_answer(result: RagAnswer, query: RagQuery, user: UserRecord, db: Session) -> QuestionResponse:
    trace_id = str(uuid4())
    response = QuestionResponse.model_validate({
        "answer": result.answer,
        "citations": [
            {"label": item.label, "document_id": item.source.document_id,
             "version_id": item.source.version_id, "chunk_id": item.source.chunk_id,
             "title": item.source.title, "page_number": item.source.page_number,
             "article_number": item.source.article_number, "source_url": item.source.source_url,
             "knowledge_base_id": item.source.knowledge_base_id, "excerpt": item.excerpt}
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


@router.post("/answer/stream", response_class=StreamingResponse)
async def stream_answer_route(
    payload: QuestionRequest,
    user: Annotated[UserRecord, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
    service: Annotated[RagService, Depends(rag_service)],
):
    query = RagQuery(payload.question, filters=RetrievalFilters(
        knowledge_base_ids=tuple(payload.knowledge_base_ids),
        effective_at=payload.effective_at or datetime.now(UTC),
    ), top_k=payload.top_k)

    def event(name, data):
        return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

    async def events():
        try:
            async for part in service.stream_answer(query):
                if isinstance(part, str):
                    yield event("delta", {"text": part})
                else:
                    response = _save_answer(part, query, user, db)
                    yield event("done", response.model_dump())
                    return
            raise GenerationFailedError("流式回答未完成")
        except asyncio.CancelledError:
            db.rollback()
            raise
        except RetrievalUnavailableError:
            yield event("error", {"error_code": "RAG_RETRIEVAL_UNAVAILABLE", "message": "检索服务暂不可用"})
        except (GenerationFailedError, GenerationContractError):
            yield event("error", {"error_code": "RAG_GENERATION_FAILED", "message": "回答生成失败，请重试"})
        except Exception as exc:
            db.rollback()
            logger.warning("流式问答处理失败：%s", type(exc).__name__)
            yield event("error", {"error_code": "QA_STREAM_FAILED", "message": "回答未能完成，请重试"})

    return StreamingResponse(events(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache", "X-Accel-Buffering": "no",
    })
