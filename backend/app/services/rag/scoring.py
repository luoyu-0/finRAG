"""证据支持度计算。"""

from __future__ import annotations

from collections.abc import Sequence

from app.domain.rag import ContextItem, EvidenceSupport, EvidenceSupportLevel


class RetrievalEvidenceScorer:
    """依据融合相关性和多通道一致性估计证据支持强弱。"""

    method = "retrieval_evidence_v1"

    def score(
        self,
        cited_items: Sequence[ContextItem],
        retriever_count: int,
    ) -> EvidenceSupport:
        """计算非概率型证据支持分数。"""

        if not cited_items:
            return EvidenceSupport(
                score=0.0,
                level=EvidenceSupportLevel.NONE,
                method=self.method,
                explanation="未引用检索证据；该分数不是答案正确概率。",
            )

        channel_denominator = max(1, retriever_count)
        item_scores = [
            0.5 * item.hit.relevance_score
            + 0.5 * min(1.0, len(item.hit.channels) / channel_denominator)
            for item in cited_items
        ]
        score = round(sum(item_scores) / len(item_scores), 4)
        if score >= 0.8:
            level = EvidenceSupportLevel.STRONG
        elif score >= 0.5:
            level = EvidenceSupportLevel.MODERATE
        else:
            level = EvidenceSupportLevel.WEAK

        return EvidenceSupport(
            score=score,
            level=level,
            method=self.method,
            explanation="综合融合相关性和检索通道一致性；该分数不是答案正确概率。",
        )
