"""分页、权限隔离、收藏生命周期及上传任务集成测试。"""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from app.main import app
from app.api.v1.page_common import now
from app.core.database import session_factory
from app.repositories.auth_models import QaRecord


class PageApiTests(unittest.TestCase):
    def test_pages(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {
            "DATABASE_URL": "sqlite:///" + tmp + "/db", "DEEPSEEK_API_KEY": "",
            "ADMIN_BOOTSTRAP_PASSWORD": "pages-test-password",
        }), patch("app.api.v1.ingestion.UPLOAD_ROOT", Path(tmp)), TestClient(app) as client:
            root = "/api/v1"
            def headers(response):
                response.raise_for_status()
                return {"Authorization": "Bearer " + response.json()["access_token"]}
            admin = headers(client.post(root+"/auth/login", json={"username":"admin","password":"pages-test-password"}))
            registration = client.post(root+"/auth/register", json={"username":"tester","password":"pages-test-password"})
            user = headers(registration)
            user_id = registration.json()["user"]["id"]
            kb = client.post(root+"/knowledge-bases", headers=admin, json={"name":"测试库"})
            self.assertEqual(kb.status_code, 201)
            key = kb.json()["id"]
            self.assertEqual(client.post(root+"/knowledge-bases", headers=user,json={"name":"无权创建"}).status_code,403)
            self.assertEqual(client.get(root+"/knowledge-bases/"+key+"/stats", headers=user).status_code,200)
            with session_factory()() as db:
                db.add(QaRecord(id="record", user_id=user_id, question="测试问题", answer="测试回答[S1]",
                                citations=[{"label":"S1","document_id":"doc","version_id":"ver","chunk_id":"chunk",
                                            "title":"测试制度","article_number":"第一条","excerpt":"测试条文"}],
                                evidence_support={"score":0,"level":"none","method":"test","explanation":"测试"},
                                warnings=[],trace_id="trace",created_at=now()))
                db.commit()
            self.assertEqual(client.get(root+"/qa/history/record", headers=admin).status_code,403)
            fav = client.post(root+"/favorites", headers=user,json={"qa_id":"record"})
            self.assertEqual(fav.status_code,201)
            # 收藏只存摘要，但页面要按问答页渲染正文与角标，因此联表带回原文与引用。
            self.assertEqual(fav.json()["answer"], "测试回答[S1]")
            self.assertEqual([c["label"] for c in fav.json()["citations"]], ["S1"])
            listed = client.get(root+"/favorites",headers=user).json()["items"][0]
            self.assertEqual(listed["answer"], "测试回答[S1]")
            self.assertEqual(listed["citations"][0]["article_number"], "第一条")
            self.assertEqual(listed["answer_excerpt"], "测试回答[S1]")
            self.assertEqual(client.post(root+"/favorites",headers=user,json={"qa_id":"record"}).status_code,409)
            history=client.get(root+"/qa/history?q=测试&favorited=true",headers=user).json()
            self.assertEqual(history["items"][0]["favorite_id"],fav.json()["id"])
            self.assertEqual(client.delete(root+"/qa/history/record",headers=user).status_code,204)
            self.assertEqual(client.get(root+"/favorites",headers=user).json()["total"],0)
            with patch("app.api.v1.ingestion.executor.submit") as submit:
                response=client.post(root+"/documents",headers=admin,data={"knowledge_base_id":key},files={"file":("样例.txt","测试正文".encode())})
                self.assertEqual(response.status_code,202,response.text)
                task=response.json()["ingestion_task"]
                submit.assert_called_once()
                self.assertEqual(client.get(root+"/ingestion-tasks/"+task["id"],headers=admin).json()["state"],"queued")
                self.assertEqual(client.post(root+"/ingestion-tasks/"+task["id"]+"/retry",headers=admin).status_code,409)
