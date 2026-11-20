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
from app.repositories.document_models import ChunkRecord, DocumentRecord


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

    def test_document_content_locates_citation(self):
        """点角标后要能拿到原文，并定位到被引分块的字符区间（契约 §8.3.1）。"""
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {
            "DATABASE_URL": "sqlite:///" + tmp + "/db", "DEEPSEEK_API_KEY": "",
            "ADMIN_BOOTSTRAP_PASSWORD": "pages-test-password",
        }), patch("app.api.v1.knowledge.RAW_ROOT", Path(tmp) / "raw"), TestClient(app) as client:
            raw = Path(tmp) / "raw"
            (raw / "txts").mkdir(parents=True)
            body = "第一条 测试正文。\n第二条 目标条文内容出现在这里。\n"
            (raw / "txts" / "样例.txt").write_text(body, encoding="utf-8")

            root = "/api/v1"
            token = client.post(root+"/auth/login", json={"username":"admin","password":"pages-test-password"}).json()["access_token"]
            auth = {"Authorization": "Bearer " + token}
            with session_factory()() as db:
                db.add(DocumentRecord(id="doc", knowledge_base_id="default", version_id="ver", title="测试制度",
                                      file_name="txts/样例.txt", file_hash="hash", policy_status="active",
                                      status_source="default", page_count=0, parse_warnings="[]", updated_at=now()))
                db.add(ChunkRecord(id="chunk", document_id="doc", version_id="ver", article_number="第二条",
                                   text="第二条 目标条文内容出现在这里。"))
                db.commit()

            content = client.get(root+"/documents/doc/content?chunk_id=chunk", headers=auth).json()
            self.assertEqual(content["source"], "txt")
            self.assertEqual(content["text"], body)
            self.assertTrue(content["anchor"]["located"])
            self.assertEqual(content["anchor"]["article_number"], "第二条")
            self.assertEqual(content["text"][content["anchor"]["start"]:content["anchor"]["end"]],
                             "第二条 目标条文内容出现在这里。")

            # 不带 chunk_id 时不返回 anchor；分块不属于本文档时报 404。
            self.assertIsNone(client.get(root+"/documents/doc/content", headers=auth).json()["anchor"])
            bad = client.get(root+"/documents/doc/content?chunk_id=other", headers=auth)
            self.assertEqual(bad.status_code, 404)
            self.assertEqual(bad.json()["error_code"], "CHUNK_NOT_FOUND")

    def test_document_file_uses_short_lived_ticket(self):
        """浏览器 PDF 阅读器拿不到 Authorization 头，改用 2 分钟票据读取原文（契约 §8.3.2）。"""
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {
            "DATABASE_URL": "sqlite:///" + tmp + "/db", "DEEPSEEK_API_KEY": "",
            "ADMIN_BOOTSTRAP_PASSWORD": "pages-test-password",
        }), patch("app.api.v1.knowledge.RAW_ROOT", Path(tmp) / "raw"), TestClient(app) as client:
            raw = Path(tmp) / "raw"
            (raw / "txts").mkdir(parents=True)
            body = "第一条 原文正文。\n"
            (raw / "txts" / "原文.txt").write_text(body, encoding="utf-8")

            root = "/api/v1"
            token = client.post(root+"/auth/login", json={"username":"admin","password":"pages-test-password"}).json()["access_token"]
            auth = {"Authorization": "Bearer " + token}
            with session_factory()() as db:
                db.add(DocumentRecord(id="doc", knowledge_base_id="default", version_id="ver", title="原文制度",
                                      file_name="txts/原文.txt", file_hash="hash", policy_status="active",
                                      status_source="default", page_count=0, parse_warnings="[]", updated_at=now()))
                db.add(DocumentRecord(id="missing", knowledge_base_id="default", version_id="ver", title="缺原文",
                                      file_name="txts/不存在.txt", file_hash="hash", policy_status="active",
                                      status_source="default", page_count=0, parse_warnings="[]", updated_at=now()))
                db.commit()

            content = client.get(root+"/documents/doc/content", headers=auth).json()
            self.assertTrue(content["has_file"])
            self.assertFalse(client.get(root+"/documents/missing/content", headers=auth).json()["has_file"])

            ticket = client.post(root+"/documents/doc/file-ticket", headers=auth)
            self.assertEqual(ticket.status_code, 200, ticket.text)
            url = ticket.json()["url"]
            self.assertTrue(url.startswith("/api/v1/documents/doc/file?token="))

            # 票据本身就是访问凭据，浏览器不再附加 Authorization。
            file_response = client.get(url)
            self.assertEqual(file_response.status_code, 200)
            self.assertEqual(file_response.content, body.encode("utf-8"))
            self.assertIn("text/plain", file_response.headers["content-type"])
            self.assertIn("inline", file_response.headers["content-disposition"])

            # 无票据、伪造票据、票据指向其他文档时拒绝。
            self.assertEqual(client.get(root+"/documents/doc/file").status_code, 401)
            forged = client.get(root+"/documents/doc/file?token=not-a-ticket")
            self.assertEqual(forged.status_code, 401)
            self.assertEqual(forged.json()["error_code"], "AUTH_FILE_TICKET_INVALID")
            self.assertEqual(client.get(url.replace("doc/file", "missing/file")).status_code, 403)
            self.assertEqual(client.post(root+"/documents/missing/file-ticket", headers=auth).json()["error_code"],
                             "DOCUMENT_FILE_MISSING")
