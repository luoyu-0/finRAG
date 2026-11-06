"""使用真实文本解析和 SQLite 验证内容去重，向量与模型用内存替身。"""

import asyncio
import hashlib
from datetime import timedelta

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.core import database
from app.domain.rag import Citation, EvidenceSupport, EvidenceSupportLevel, RagAnswer, SourceReference
from app.repositories.document_deduplication import duplicate_groups, remove_document_index
from app.repositories.document_models import ChunkRecord, DocumentRecord
from app.workers import import_documents
from app.workers.evaluate_qa import _evaluate, _validate_cases


class MemoryVectors:
    def __init__(self):
        self.rows = {}

    def upsert(self, rows):
        self.rows.update({row["id"]: row for row in rows})

    def delete_ids(self, ids):
        for key in ids:
            self.rows.pop(key, None)


class StubEmbedding:
    def __init__(self):
        self.calls = 0
        self.fail = False

    def embed_documents(self, texts):
        self.calls += 1
        if self.fail:
            raise RuntimeError("模拟向量化失败")
        return [[0.0] * 512 for _ in texts]


@pytest.fixture
def importer(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'import.db'}")
    database.Base.metadata.create_all(engine)
    sessions = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(database, "_session_factory", sessions)
    root = tmp_path / "data" / "raw"
    root.mkdir(parents=True)
    vectors, embedding = MemoryVectors(), StubEmbedding()

    def run(name, text="第一条 银行应当审核开户资料。", *, kb="default", metadata=None, rebuild=False):
        path = root / name
        path.write_text(text, encoding="utf-8")
        return import_documents.import_file(
            path, name, kb, metadata or {}, vectors, embedding, rebuild=rebuild,
        )

    yield run, sessions, vectors, embedding, root
    engine.dispose()


@pytest.mark.parametrize("name", ["原文件.txt", "其他名称.txt"])
def test_same_content_skips_parsing_and_writes(importer, monkeypatch, name):
    run, sessions, vectors, embedding, _ = importer
    run("原文件.txt")
    before = dict(vectors.rows)
    calls = embedding.calls

    def unexpected_parse(*args, **kwargs):
        raise AssertionError("重复内容不应再次解析或 OCR")

    monkeypatch.setattr(import_documents, "parse_document", unexpected_parse)
    count, warnings = run(name)
    assert count == 0 and "原文件.txt" in warnings[0]
    assert vectors.rows == before and embedding.calls == calls
    with sessions() as db:
        assert len(list(db.scalars(select(DocumentRecord)))) == 1


def test_same_path_changed_content_replaces_old_chunks(importer):
    run, sessions, vectors, _, _ = importer
    run("制度.txt")
    old_ids = set(vectors.rows)
    count, _ = run("制度.txt", "第一条 商业银行应当建立风险管理制度。")
    assert count > 0 and not old_ids.intersection(vectors.rows)
    with sessions() as db:
        assert len(list(db.scalars(select(DocumentRecord)))) == 1
        assert "风险管理" in db.scalar(select(ChunkRecord.text))


def test_same_content_in_different_knowledge_bases_is_independent(importer):
    run, sessions, vectors, _, _ = importer
    run("制度.txt", kb="a")
    assert run("制度.txt", kb="b")[0] > 0
    with sessions() as db:
        assert len(list(db.scalars(select(DocumentRecord)))) == 2
    assert {row["knowledge_base_id"] for row in vectors.rows.values()} == {"a", "b"}


def test_metadata_change_requires_explicit_rebuild(importer):
    run, sessions, vectors, _, _ = importer
    run("制度.txt")
    with pytest.raises(ValueError, match="元数据不同"):
        run("制度.txt", metadata={"policy_status": "inactive"})
    assert run("制度.txt", metadata={"policy_status": "inactive"}, rebuild=True)[0] > 0
    with sessions() as db:
        assert db.scalar(select(DocumentRecord.policy_status)) == "inactive"
    assert {row["policy_status"] for row in vectors.rows.values()} == {"inactive"}


def test_rebuild_does_not_create_duplicate_from_another_filename(importer):
    run, sessions, vectors, embedding, _ = importer
    run("原文件.txt")
    calls = embedding.calls
    assert run("副本.txt", rebuild=True)[0] == 0
    assert embedding.calls == calls
    with sessions() as db:
        assert len(list(db.scalars(select(DocumentRecord)))) == 1


def test_path_changed_to_duplicate_removes_stale_content(importer):
    run, sessions, vectors, _, _ = importer
    run("保留.txt", "第一条 需要保留的内容。")
    run("变化.txt", "第一条 已经过时的内容。")
    assert run("变化.txt", "第一条 需要保留的内容。")[0] == 0
    with sessions() as db:
        assert [d.file_name for d in db.scalars(select(DocumentRecord))] == ["保留.txt"]
    assert all("过时" not in row["text"] for row in vectors.rows.values())


def test_failed_import_is_not_treated_as_successful_duplicate(importer):
    run, sessions, _, embedding, _ = importer
    embedding.fail = True
    with pytest.raises(RuntimeError, match="模拟向量化失败"):
        run("制度.txt")
    with sessions() as db:
        assert db.scalar(select(DocumentRecord)) is None
    embedding.fail = False
    assert run("制度.txt")[0] > 0


def test_cleanup_keeps_first_record_and_removes_only_duplicate_vectors(importer):
    run, sessions, vectors, _, _ = importer
    run("原文件.txt")
    run("另一知识库.txt", kb="other")
    with sessions() as db:
        original = db.scalar(select(DocumentRecord).where(DocumentRecord.knowledge_base_id == "default"))
        values = {column.name: getattr(original, column.name) for column in DocumentRecord.__table__.columns}
        values.update(id="duplicate", file_name="副本.txt", updated_at=original.updated_at + timedelta(seconds=1))
        db.add(DocumentRecord(**values))
        db.add(ChunkRecord(id="duplicate-chunk", document_id="duplicate", version_id=original.version_id, text="重复分块"))
        vectors.rows["duplicate-chunk"] = {"text": "重复分块"}
        db.commit()
        groups = duplicate_groups(db, "default")
        assert len(groups) == 1 and groups[0][0].id == original.id
        for duplicate in groups[0][1:]:
            remove_document_index(db, duplicate, vectors)
        db.commit()
        assert duplicate_groups(db, "default") == []
        assert len(list(db.scalars(select(DocumentRecord)))) == 2
        assert db.get(ChunkRecord, "duplicate-chunk") is None
    assert "duplicate-chunk" not in vectors.rows


def test_evaluation_resolves_duplicate_filename_by_content(importer):
    run, sessions, _, _, root = importer
    run("保留.txt")
    run("测试集文件名.txt")
    raw = (root / "测试集文件名.txt").read_bytes()
    case = {
        "id": 1, "question": "银行应当做什么？", "ground_truth": "审核开户资料。",
        "source_file": "data/raw/测试集文件名.txt", "source_sha256": hashlib.sha256(raw).hexdigest(),
        "evidence_excerpt": "银行应当审核开户资料。", "relevant_clause": "第一条",
    }
    ids = _validate_cases([case], root.parent.parent, "default")
    with sessions() as db:
        document = db.scalar(select(DocumentRecord))
        assert ids == {1: frozenset({document.id})}
        source = SourceReference(
            knowledge_base_id="default", document_id=document.id, version_id=document.version_id,
            chunk_id="chunk", title=document.title, article_number="第一条",
        )

    class Service:
        async def answer(self, query):
            return RagAnswer(
                answer="审核开户资料。", citations=(Citation("S1", source),),
                evidence_support=EvidenceSupport(0.8, EvidenceSupportLevel.STRONG, "test", "测试"),
            )

    result = asyncio.run(_evaluate([case], Service(), "default", ids))
    assert result[0]["source_hit"] and result[0]["clause_hit"]
    with pytest.raises(ValueError, match="索引缺失"):
        _validate_cases([case], root.parent.parent, "other")
    (root / "测试集文件名.txt").write_text("原文已经改变", encoding="utf-8")
    with pytest.raises(ValueError, match="原文哈希"):
        _validate_cases([case], root.parent.parent, "default")
