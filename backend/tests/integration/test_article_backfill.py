"""回填使用真实 SQLite 元数据，验证只修改条号且可重跑。"""

from copy import deepcopy
from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core import database
from app.repositories.document_models import ChunkRecord, DocumentRecord
from app.workers.backfill_articles import backfill


class Vectors:
    def __init__(self, row):
        self.row = row

    def get(self, **kwargs):
        return [deepcopy(self.row)]

    def upsert(self, **kwargs):
        self.row = deepcopy(kwargs["data"][0])


@pytest.fixture
def records(monkeypatch):
    engine = create_engine("sqlite://")
    database.Base.metadata.create_all(engine)
    sessions = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(database, "_session_factory", sessions)
    text = "第二章 许可 第六条 机构应取得许可。"
    with sessions() as db:
        db.add(DocumentRecord(id="d", knowledge_base_id="kb", version_id="v", title="制度", file_name="制度.txt", file_hash="hash",
                              policy_status="active", status_source="default", page_count=0, updated_at=datetime.now(UTC)))
        db.add(ChunkRecord(id="c", document_id="d", version_id="v", text=text))
        db.commit()
    vectors = Vectors({"id": "c", "text": text, "version_id": "v", "article_number": "", "vector": [0.2, 0.8]})
    yield sessions, vectors
    engine.dispose()


def test_preview_apply_and_retry_preserve_content(records):
    sessions, vectors = records
    original = deepcopy(vectors.row)
    assert backfill(None, "other", apply=False) == 0
    assert backfill(None, "kb", apply=False) == 1
    assert vectors.row == original
    assert backfill(vectors, "kb", apply=True) == 1
    assert backfill(vectors, "kb", apply=True) == 0
    assert vectors.row == {**original, "article_number": "第六条"}
    with sessions() as db:
        chunk = db.get(ChunkRecord, "c")
        assert chunk.text == original["text"] and chunk.article_number == "第六条"


def test_conflicting_vector_does_not_update_mysql(records):
    sessions, vectors = records
    vectors.row["text"] = "另一个版本"
    with pytest.raises(ValueError, match="不一致"):
        backfill(vectors, "kb", apply=True)
    with sessions() as db:
        assert db.get(ChunkRecord, "c").article_number is None
