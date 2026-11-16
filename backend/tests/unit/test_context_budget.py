"""上下文条目预算不能提前终止首条证据后的组装。"""

import unittest

from app.domain.rag import FusedHit, SourceReference
from app.services.rag.context import ContextAssembler


class ContextBudgetTests(unittest.TestCase):
    def test_chunk_limit_keeps_entire_allowed_prefix(self):
        hits = tuple(FusedHit(text="制度正文。", source=SourceReference(
            knowledge_base_id="kb", document_id="doc", version_id="v", chunk_id=str(i), title="制度",
        ), relevance_score=1.0, channels=("vector",), channel_ranks=(("vector", i + 1),)) for i in range(10))
        context = ContextAssembler(max_chunks=8).assemble(hits)
        self.assertEqual(len(context.items), 8)
        self.assertTrue(context.truncated)
