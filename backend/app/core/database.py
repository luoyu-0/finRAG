"""MySQL 会话与初始表结构。"""

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


_engine = None
_session_factory = None


def initialize_database() -> None:
    global _engine, _session_factory
    settings = get_settings()
    _engine = create_engine(settings.database_url, pool_pre_ping=True)
    _session_factory = sessionmaker(_engine, expire_on_commit=False)
    from app.repositories import auth_models  # noqa: F401

    Base.metadata.create_all(_engine)


def get_db() -> Iterator[Session]:
    if _session_factory is None:
        raise RuntimeError("数据库尚未初始化")
    with _session_factory() as session:
        yield session


def session_factory() -> sessionmaker[Session]:
    if _session_factory is None:
        raise RuntimeError("数据库尚未初始化")
    return _session_factory
