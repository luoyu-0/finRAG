"""多通道检索结果融合。"""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from math import log
import re

from app.domain.rag import FusedHit, RetrievalHit


_QUESTION_FRAME = re.compile(
    r"^(?:什么是|请问)|(?:是?什么|如何处理|应如何|分别是多少|是什么形式|是什么|有哪些|包括哪些|怎么办|如何)$"
)
_WORD = re.compile(r"[^\W_]+")


def _term_coverage(question: str, hits: Sequence[FusedHit]) -> dict[str, float]:
    """只对候选范围内的问题短语计分，降低共有主题词的权重。"""
    query = _QUESTION_FRAME.sub("", "".join(question.casefold().split()).rstrip("？?。"))
    terms = {
        word[start:start + size]
        for word in _WORD.findall(query)
        for size in (2, 3)
        for start in range(len(word) - size + 1)
    }
    matches = {}
    for hit in hits:
        body = "".join(hit.text.casefold().split())
        matches[hit.source.chunk_id] = {term for term in terms if term in body}
    counts = Counter(term for found in matches.values() for term in found)
    weights = {term: len(term) * log((len(hits) + 1) / (counts[term] + 1)) for term in sorted(terms)}
    total = sum(weights.values())
    if not total or not any(weights[term] for term in counts):
        return {}
    return {key: sum(weights[term] for term in sorted(found)) / total for key, found in matches.items()}



class ReciprocalRankFusion:
    """使用 RRF 对不同量纲的检索排名进行稳定融合。"""

    def __init__(
        self,
        channel_weights: Mapping[str, float] | None = None,
        rank_constant: int = 60,
    ) -> None:
        if rank_constant < 1:
            raise ValueError("rank_constant 必须大于 0")
        if channel_weights and any(weight <= 0 for weight in channel_weights.values()):
            raise ValueError("检索通道权重必须大于 0")
        self._channel_weights = dict(channel_weights or {})
        self._rank_constant = rank_constant

    def fuse(
        self,
        results: Mapping[str, Sequence[RetrievalHit]],
        limit: int,
        *,
        question: str = "",
    ) -> tuple[FusedHit, ...]:
        """按 Chunk ID 去重并返回归一化融合分数。"""

        if limit < 1:
            return ()

        scores: dict[str, float] = defaultdict(float)
        hits: dict[str, RetrievalHit] = {}
        ranks: dict[str, dict[str, int]] = defaultdict(dict)
        active_channels = tuple(results)

        for channel, channel_hits in results.items():
            weight = self._channel_weights.get(channel, 1.0)
            seen_in_channel: set[str] = set()
            for rank, hit in enumerate(channel_hits, start=1):
                chunk_id = hit.source.chunk_id
                if chunk_id in seen_in_channel:
                    continue
                seen_in_channel.add(chunk_id)
                existing = hits.get(chunk_id)
                if existing is not None and existing.source != hit.source:
                    raise ValueError(f"Chunk {chunk_id} 的来源信息不一致")
                if existing is None or len(hit.text) > len(existing.text):
                    hits[chunk_id] = hit
                scores[chunk_id] += weight / (self._rank_constant + rank)
                ranks[chunk_id][channel] = rank

        max_score = sum(
            self._channel_weights.get(channel, 1.0) / (self._rank_constant + 1)
            for channel in active_channels
        )
        if max_score == 0:
            return ()

        fused = [
            FusedHit(
                text=hit.text,
                source=hit.source,
                relevance_score=min(1.0, scores[chunk_id] / max_score),
                channels=tuple(sorted(ranks[chunk_id])),
                channel_ranks=tuple(sorted(ranks[chunk_id].items())),
            )
            for chunk_id, hit in hits.items()
        ]
        fused.sort(key=lambda item: (-item.relevance_score, item.source.chunk_id))
        return tuple(fused[:limit])


class PolicySearchFusion(ReciprocalRankFusion):
    """保留双通道共识，再结合加权排名和正文中的问题短语排序。"""

    def __init__(self) -> None:
        super().__init__({"vector": 2}, rank_constant=5)

    def fuse(
        self, results: Mapping[str, Sequence[RetrievalHit]], limit: int, *, question: str = "",
    ) -> tuple[FusedHit, ...]:
        if limit < 1:
            return ()
        weighted = super().fuse(results, sum(len(hits) for hits in results.values()))
        coverage = _term_coverage(question, weighted) if question else {}
        if coverage:
            weighted = tuple(sorted(weighted, key=lambda hit: (
                -(hit.relevance_score + 0.8 * coverage.get(hit.source.chunk_id, 0)),
                hit.source.chunk_id,
            )))
        # 为双路共识保留部分名额，剩余用于提升包含判别性短语的候选。
        consensus_limit = limit // 3 if coverage else limit * 2 // 3
        consensus = ReciprocalRankFusion().fuse(results, consensus_limit)
        selected = {item.source.chunk_id for item in consensus}
        for item in weighted:
            if len(selected) >= limit:
                break
            selected.add(item.source.chunk_id)
        return tuple(item for item in weighted if item.source.chunk_id in selected)
