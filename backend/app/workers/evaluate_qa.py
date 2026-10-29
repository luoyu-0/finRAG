"""运行固定问答集并将逐题结果写入 JSON 与 Markdown 报告。"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
from datetime import UTC, datetime
from difflib import SequenceMatcher
from pathlib import Path

from sqlalchemy import select

from app.core.database import initialize_database, session_factory
from app.domain.rag import RagQuery, RetrievalFilters
from app.repositories.document_models import DocumentRecord
from app.repositories.keyword_chunks import KeywordChunkRetriever
from app.repositories.milvus_chunks import MilvusChunkRepository
from app.services.rag.deepseek import DeepSeekAnswerGenerator
from app.services.rag.embedding import BgeEmbeddingProvider
from app.services.rag.orchestrator import RagService


def _plain_text(value: str) -> str:
    value = re.sub(r"[#*`_>\[\]]", "", value)
    value = re.sub(r"\s+", "", value)
    return value.removeprefix("结论")


def _validate_cases(cases: list[dict], root: Path, knowledge_base_id: str) -> None:
    errors = []
    with session_factory()() as db:
        for case in cases:
            source = (root / case["source_file"]).resolve()
            if not source.is_relative_to(root) or not source.is_file():
                errors.append(f"题 {case['id']}：来源文件不存在")
                continue
            raw = source.read_bytes()
            digest = hashlib.sha256(raw).hexdigest()
            if digest != case["source_sha256"]:
                errors.append(f"题 {case['id']}：原文哈希与测试集不符")
            try:
                content = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                content = raw.decode("gb18030")
            if re.sub(r"\s+", "", case["evidence_excerpt"]) not in re.sub(r"\s+", "", content):
                errors.append(f"题 {case['id']}：证据摘录不在原文中")
            relative = source.relative_to(root / "data" / "raw").as_posix()
            document_id = hashlib.sha256(f"{knowledge_base_id}:{relative}".encode()).hexdigest()[:32]
            record = db.scalar(select(DocumentRecord).where(DocumentRecord.id == document_id))
            if record is None or record.file_hash != digest:
                errors.append(f"题 {case['id']}：索引缺失或尚未按新原文重建")
    if errors:
        raise ValueError("评测前校验失败：\n" + "\n".join(errors))


async def _evaluate(cases: list[dict], service: RagService, knowledge_base_id: str) -> list[dict]:
    results = []
    for case in cases:
        started = datetime.now(UTC)
        item = {"id": case["id"], "question": case["question"], "ground_truth": case["ground_truth"]}
        try:
            answer = await service.answer(RagQuery(
                case["question"], filters=RetrievalFilters(knowledge_base_ids=(knowledge_base_id,)),
            ))
            expected_relative = case["source_file"].removeprefix("data/raw/")
            expected_id = hashlib.sha256(f"{knowledge_base_id}:{expected_relative}".encode()).hexdigest()[:32]
            item.update({
                "answer": answer.answer,
                "similarity": round(SequenceMatcher(None, _plain_text(case["ground_truth"]), _plain_text(answer.answer)).ratio(), 4),
                "source_hit": any(c.source.document_id == expected_id for c in answer.citations),
                "clause_hit": any(c.source.document_id == expected_id and c.source.article_number == case["relevant_clause"] for c in answer.citations),
                "citations": [{"document_id": c.source.document_id, "title": c.source.title,
                               "article_number": c.source.article_number, "chunk_id": c.source.chunk_id}
                              for c in answer.citations],
                "evidence_support": answer.evidence_support.score,
                "warnings": list(answer.warnings),
            })
        except Exception as exc:
            item["error"] = f"{type(exc).__name__}: {exc}"
        item["duration_seconds"] = round((datetime.now(UTC) - started).total_seconds(), 2)
        results.append(item)
        print(f"题 {case['id']}/{cases[-1]['id']}：{'失败' if 'error' in item else '完成'}", flush=True)
    return results


def _write_report(path: Path, results: list[dict]) -> None:
    completed = [row for row in results if "error" not in row]
    summary = {
        "total": len(results), "completed": len(completed), "failed": len(results) - len(completed),
        "mean_similarity": round(sum(row["similarity"] for row in completed) / len(completed), 4) if completed else 0,
        "source_hit_rate": round(sum(row["source_hit"] for row in completed) / len(completed), 4) if completed else 0,
        "clause_hit_rate": round(sum(row["clause_hit"] for row in completed) / len(completed), 4) if completed else 0,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"summary": summary, "results": results}, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = ["# 问答基准评测", "", f"完成 {summary['completed']}/{summary['total']}；失败 {summary['failed']}。",
             f"平均文本相似度 {summary['mean_similarity']:.1%}；来源命中率 {summary['source_hit_rate']:.1%}；条文命中率 {summary['clause_hit_rate']:.1%}。",
             "", "文本相似度只是字面参考，不能替代人工核对答案事实与引用。", ""]
    for row in results:
        lines.extend([f"## 题 {row['id']}：{row['question']}", "", f"标准答案：{row['ground_truth']}", ""])
        if "error" in row:
            lines.extend([f"错误：{row['error']}", ""])
        else:
            lines.extend([f"实际回答：\n\n{row['answer']}", "",
                          f"文本相似度：{row['similarity']:.1%}；来源命中：{'是' if row['source_hit'] else '否'}；条文命中：{'是' if row['clause_hit'] else '否'}。", "",
                          "引用：" + "；".join(f"{c['title']} {c['article_number'] or ''}" for c in row["citations"]), ""])
    path.with_suffix(".md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="运行问答基准并输出效果报告")
    parser.add_argument("--dataset", type=Path, default=Path("/app/data/samples/qa_50_from_raw.json"))
    parser.add_argument("--output", type=Path, default=Path("/app/data/processed/qa_evaluation.json"))
    parser.add_argument("--root", type=Path, default=Path("/app"))
    parser.add_argument("--knowledge-base-id", default="default")
    parser.add_argument("--limit", type=int, default=0, help="仅运行前 N 题；0 表示全部")
    args = parser.parse_args()
    if args.limit < 0:
        parser.error("limit 不能为负数")
    cases = json.loads(args.dataset.read_text(encoding="utf-8"))
    if not isinstance(cases, list) or len(cases) != 50:
        parser.error("测试集必须包含 50 题")
    selected = cases[:args.limit] if args.limit else cases
    initialize_database()
    _validate_cases(selected, args.root.resolve(), args.knowledge_base_id)
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        parser.error("DEEPSEEK_API_KEY 未配置")
    embedding = BgeEmbeddingProvider()
    vector = MilvusChunkRepository(
        f"http://{os.getenv('MILVUS_HOST', 'milvus')}:{os.getenv('MILVUS_PORT', '19530')}", embedding,
    )
    service = RagService((vector, KeywordChunkRetriever()),
                         DeepSeekAnswerGenerator(api_key, model=os.getenv("DEEPSEEK_MODEL", "deepseek-flash")))
    results = asyncio.run(_evaluate(selected, service, args.knowledge_base_id))
    _write_report(args.output, results)
    print(f"报告已写入 {args.output} 和 {args.output.with_suffix('.md')}")


if __name__ == "__main__":
    main()
