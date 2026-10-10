"""多通道检索结果融合。"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence

from app.domain.rag import FusedHit, RetrievalHit


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
