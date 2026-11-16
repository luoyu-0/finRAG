"""当前用户的问答历史与收藏。"""

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app.api.v1.page_common import Db, Paging, User, now, paginate, utc
from app.core.exceptions import ApiError
from app.repositories.auth_models import QaRecord
from app.repositories.page_models import Favorite, QuestionFilters

from app.schemas.pages import FavoriteInfo, History, Page

router = APIRouter(prefix="/api/v1", tags=["问答历史与收藏"])
history = select(QaRecord, Favorite, QuestionFilters).outerjoin(Favorite, Favorite.qa_id == QaRecord.id).outerjoin(QuestionFilters, QuestionFilters.qa_id == QaRecord.id)


def owned(db, qa_id, user):
    row = db.execute(history.where(QaRecord.id == qa_id)).first()
    if not row:
        raise ApiError(404, "QA_RECORD_NOT_FOUND", "问答记录不存在")
    if row[0].user_id != user.id:
        raise ApiError(403, "AUTH_FORBIDDEN", "只能访问本人的记录")
    return row


def record_view(record, favorite, filters):
    return dict(id=record.id, question=record.question, answer=record.answer, citations=record.citations,
                evidence_support=record.evidence_support, warnings=record.warnings, trace_id=record.trace_id,
                knowledge_base_ids=filters.knowledge_base_ids if filters else [], effective_at=utc(filters.effective_at) if filters else None,
                favorite_id=favorite.id if favorite else None, favorited=bool(favorite), created_at=utc(record.created_at))


def favorite_view(favorite, record):
    return dict(id=favorite.id, qa_id=record.id, question=record.question, answer_excerpt=record.answer[:120],
                evidence_support={k: record.evidence_support[k] for k in ("score", "level")},
                citation_count=len(record.citations), created_at=utc(favorite.created_at))


@router.get("/qa/history", response_model=Page[History])
def list_history(db: Db, user: User, paging: Paging, q: str = "", favorited: bool | None = None):
    stmt = history.where(QaRecord.user_id == user.id)
    if q:
        stmt = stmt.where(QaRecord.question.contains(q, autoescape=True))
    if favorited is not None:
        stmt = stmt.where(Favorite.id.is_not(None) if favorited else Favorite.id.is_(None))
    return paginate(db, stmt.order_by(QaRecord.created_at.desc(), QaRecord.id), paging, record_view)


@router.get("/qa/history/{qa_id}", response_model=History)
def get_history(qa_id: str, db: Db, user: User):
    return record_view(*owned(db, qa_id, user))


@router.delete("/qa/history/{qa_id}", status_code=204)
def delete_history(qa_id: str, db: Db, user: User):
    record, favorite, filters = owned(db, qa_id, user)
    for child in (favorite, filters):
        if child:
            db.delete(child)
    db.flush()
    db.delete(record)
    db.commit()


@router.get("/favorites", response_model=Page[FavoriteInfo])
def list_favorites(db: Db, user: User, paging: Paging):
    stmt = select(Favorite, QaRecord).join(QaRecord).where(QaRecord.user_id == user.id).order_by(Favorite.created_at.desc(), Favorite.id)
    return paginate(db, stmt, paging, favorite_view)


class FavoriteRequest(BaseModel):
    qa_id: str = Field(min_length=1, max_length=36)


@router.post("/favorites", status_code=201, response_model=FavoriteInfo)
def add_favorite(payload: FavoriteRequest, db: Db, user: User):
    record, _, _ = owned(db, payload.qa_id, user)
    favorite = Favorite(qa_id=record.id, created_at=now())
    db.add(favorite)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "FAVORITE_ALREADY_EXISTS", "已收藏该回答")
    return favorite_view(favorite, record)


@router.delete("/favorites/{favorite_id}", status_code=204)
def remove_favorite(favorite_id: str, db: Db, user: User):
    favorite = db.get(Favorite, favorite_id)
    if not favorite:
        raise ApiError(404, "FAVORITE_NOT_FOUND", "收藏不存在")
    owned(db, favorite.qa_id, user)
    db.delete(favorite)
    db.commit()
