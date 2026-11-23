"""固定已记录的两路候选，对比最终提示词中完整证据摘录的命中数。"""

import argparse
import json
from pathlib import Path

from app.domain.rag import RetrievalHit, SourceReference
from app.services.rag.context import ContextAssembler
from app.services.rag.fusion import PolicySearchFusion, ReciprocalRankFusion


def compare(snapshot, cases):
    totals = {}
    for name, fusion in (("原 RRF", ReciprocalRankFusion(rank_constant=60)),
                         ("语义加权 RRF", PolicySearchFusion())):
        for size in (8, 12):
            assembler = ContextAssembler(max_chunks=size)
            count = 0
            misses = []
            reciprocal_ranks = []
            for row in snapshot["results"]:
                case = cases[row["id"]]
                assert case["question"] == row["question"]
                channels = {}
                for channel in ("vector", "keyword"):
                    channels[channel] = []
                    for item in row["stages"].get(channel, {}).get("hits", []):
                        source = SourceReference("default", item["document_id"], "replay",
                                                 item["chunk_id"], item["title"],
                                                 article_number=item["article_number"])
                        channels[channel].append(RetrievalHit(item["text"], source, 0))
                context = assembler.assemble(fusion.fuse(channels, size))
                evidence = "".join(case["evidence_excerpt"].split())
                rank = next((i for i, item in enumerate(context.items, 1)
                             if evidence in "".join(item.rendered_text.split())), None)
                reciprocal_ranks.append(1 / rank if rank else 0)
                if rank:
                    count += 1
                else:
                    misses.append(row["id"])
            totals[f"{name} / {size}"] = {"命中": count, "MRR": round(sum(reciprocal_ranks) / len(reciprocal_ranks), 4), "未命中题号": misses}
    return totals


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("dataset", type=Path)
    args = parser.parse_args()
    cases = json.loads(args.dataset.read_bytes())
    print(json.dumps(compare(json.loads(args.snapshot.read_bytes()), {c["id"]: c for c in cases}),
                     ensure_ascii=False, indent=2))
