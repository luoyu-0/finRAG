"""文档查询在完整结果集上筛选、排序与分页的回归测试。"""

import os
import tempfile
from datetime import timedelta
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.api.v1.page_common import now
from app.core.database import session_factory
from app.main import app
from app.repositories.document_models import ChunkRecord, DocumentRecord
from app.repositories.page_models import KnowledgeBase


def test_document_query():
    with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {
        "DATABASE_URL": "sqlite:///" + tmp + "/db",
        "DEEPSEEK_API_KEY": "", "ADMIN_BOOTSTRAP_PASSWORD": "query-test-password",
    }), TestClient(app) as client:
        token = client.post("/api/v1/auth/login", json={
            "username": "admin", "password": "query-test-password",
        }).json()["access_token"]
        auth = {"Authorization": "Bearer " + token}
        fixtures = [
            ("a", "Alpha", "txts/(信贷)_甲.TXT", "[]", 0),
            ("b", "Bravo", "pdfs/(信贷)_乙.pdf", '["告警"]', 3),
            ("c", "Charlie", "txts/(支付)_丙.txt", "[ ]", 1),
            ("d", "Delta", "(目录)_/普通.pdf", "", 2),
            ("e", "Echo", "uploads/task/(支付)_戊.PDF", "[]", 1),
        ]
        with session_factory()() as db:
            timestamp = now()
            db.add(KnowledgeBase(id="empty", name="空库", created_at=timestamp, updated_at=timestamp))
            for index, (key, title, name, warnings, count) in enumerate(fixtures):
                db.add(DocumentRecord(
                    id=key, knowledge_base_id="default", version_id=key, title=title,
                    file_name=name, file_hash=key, policy_status="inactive" if key == "b" else "active",
                    status_source="default", page_count=1, parse_warnings=warnings,
                    updated_at=timestamp + timedelta(seconds=index),
                ))
                db.flush()
                for number in range(count):
                    db.add(ChunkRecord(id=f"{key}-{number}", document_id=key, version_id=key, text="正文"))
            db.add(DocumentRecord(
                id="other", knowledge_base_id="other", version_id="other", title="Alpha",
                file_name="(其他)_他.txt", file_hash="other", policy_status="active",
                status_source="default", page_count=1, parse_warnings="[]", updated_at=timestamp,
            ))
            db.commit()

        def query(**params):
            response = client.get("/api/v1/documents", headers=auth,
                                  params={"knowledge_base_id": "default", **params})
            assert response.status_code == 200, response.text
            return response.json()

        for sort, ascending in {
            "title": ["a", "b", "c", "d", "e"],
            "updated_at": ["a", "b", "c", "d", "e"],
            "chunk_count": ["a", "c", "e", "d", "b"],
            "category": ["a", "b", "c", "e", "d"],
        }.items():
            for order in ("asc", "desc"):
                pages = [query(sort=sort, order=order, page=page, page_size=2) for page in (1, 2, 3)]
                ids = [item["id"] for page in pages for item in page["items"]]
                if order == "asc":
                    assert ids == ascending
                elif sort == "chunk_count":
                    assert ids == ["b", "d", "c", "e", "a"]
                elif sort == "category":
                    assert ids == ["d", "c", "e", "a", "b"]
                else:
                    assert ids == ascending[::-1]
                assert all(page["total"] == 5 for page in pages)
                assert [page["has_next"] for page in pages] == [True, True, False]

        assert query(page=4, page_size=2)["items"] == []
        assert query(category="未分类")["items"][0]["id"] == "d"
        assert query(category="信贷", format="txt", q="ALP", policy_status="active")["total"] == 1
        assert query(format="pdf")["total"] == 3
        assert query(has_warning=True)["items"][0]["id"] == "b"
        assert query(has_warning=False)["total"] == 4
        assert query(q="%")["total"] == 0
        assert query(category="不存在")["total"] == 0

        categories = client.get("/api/v1/knowledge-bases/default/categories", headers=auth).json()
        assert categories == {
            "items": [{"category": "信贷", "document_count": 2},
                      {"category": "支付", "document_count": 2},
                      {"category": "未分类", "document_count": 1}],
            "total": 3, "page": 1, "page_size": 3, "has_next": False,
        }
        assert client.get("/api/v1/knowledge-bases/empty/categories", headers=auth).json()["total"] == 0
        assert client.get("/api/v1/knowledge-bases/missing/categories", headers=auth).status_code == 404
        assert client.get("/api/v1/knowledge-bases/default/categories").status_code == 401
        for params in ({"sort": "invalid"}, {"order": "invalid"}, {"format": "exe"},
                       {"has_warning": "invalid"}, {"page": 0}, {"page_size": 101}):
            assert client.get("/api/v1/documents", headers=auth, params=params).status_code == 422
