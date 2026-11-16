"""只读分阶段检索诊断，不调用 LLM，不改变固定评测标准。"""

import argparse
import asyncio
import json
import os
import re
from pathlib import Path

from sqlalchemy import select

from app.core.database import initialize_database, session_factory
from app.domain.rag import RagQuery, RetrievalFilters
from app.repositories.document_models import ChunkRecord
from app.repositories.keyword_chunks import KeywordChunkRetriever
from app.repositories.milvus_chunks import MilvusChunkRepository
from app.services.rag.embedding import BgeEmbeddingProvider
from app.services.rag.orchestrator import RagService
from app.workers.evaluate_qa import _validate_cases


def compact(text):
    return re.sub(r"\s+", "", text)


async def diagnose(cases, service, knowledge_base_id, indexed_ids):
    results = []
    with session_factory()() as db:
        for case in cases:
            ids = indexed_ids[case["id"]]
            chunks = list(db.scalars(select(ChunkRecord).where(ChunkRecord.document_id.in_(ids))))
            evidence = compact(case["evidence_excerpt"])
            evidence_ids = {chunk.id for chunk in chunks if evidence in compact(chunk.text)}
            query = RagQuery(case["question"], filters=RetrievalFilters(knowledge_base_ids=(knowledge_base_id,)))
            retrieved = await service._retrieve_query(query)
            prepared = await service._prepare_context(retrieved)
            stages = dict(retrieved.results)
            stages["context"] = tuple(item.hit for item in prepared.context.items)
            row = {"id": case["id"], "question": case["question"],
                   "evidence_chunks": len(evidence_ids),
                   "evidence_metadata_missing": any(chunk.id in evidence_ids and not chunk.article_number for chunk in chunks),
                   "warnings": prepared.warnings, "stages": {}}
            for name, hits in stages.items():
                row["stages"][name] = {
                    "source_hit": any(hit.source.document_id in ids for hit in hits),
                    "clause_hit": any(hit.source.document_id in ids and hit.source.article_number == case["relevant_clause"] for hit in hits),
                    "evidence_hit": any(hit.source.chunk_id in evidence_ids for hit in hits),
                    "hits": [{"chunk_id": hit.source.chunk_id, "document_id": hit.source.document_id,
                              "article_number": hit.source.article_number, "title": hit.source.title,
                              "text": hit.text} for hit in hits],
                }
            results.append(row)
            print(f"诊断 {case['id']}：完成", flush=True)
    return results


def main():
    parser = argparse.ArgumentParser(description="不调用模型的分阶段检索诊断")
    parser.add_argument("--dataset", type=Path, default=Path("/app/data/samples/qa_100_from_raw.json"))
    parser.add_argument("--root", type=Path, default=Path("/app"))
    parser.add_argument("--output", type=Path, default=Path("/app/data/processed/retrieval_diagnosis.json"))
    parser.add_argument("--knowledge-base-id", default="default")
    args = parser.parse_args()
    cases = json.loads(args.dataset.read_text(encoding="utf-8"))
    initialize_database()
    ids = _validate_cases(cases, args.root.resolve(), args.knowledge_base_id)
    vector = MilvusChunkRepository(f"http://{os.getenv('MILVUS_HOST', 'milvus')}:{os.getenv('MILVUS_PORT', '19530')}", BgeEmbeddingProvider())
    # 诊断只执行检索和上下文组装，生成器不会被调用。
    service = RagService((vector, KeywordChunkRetriever()), None)
    results = asyncio.run(diagnose(cases, service, args.knowledge_base_id, ids))
    summary = {name: {metric: sum(row["stages"].get(name, {}).get(metric, False) for row in results)
                      for metric in ("source_hit", "clause_hit", "evidence_hit")}
               for name in ("vector", "keyword", "context")}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"total": len(results), "summary": summary, "results": results}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
