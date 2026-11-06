"""查询侧指令不能污染文档向量或重复添加。"""

from unittest.mock import Mock

import numpy as np

from app.services.rag.embedding import BgeEmbeddingProvider


def test_query_instruction_is_added_only_to_queries():
    provider = BgeEmbeddingProvider.__new__(BgeEmbeddingProvider)
    provider._model = Mock()
    provider._model.query_embed.return_value = iter([np.array([1.0])])
    provider._model.embed.return_value = iter([np.array([1.0])])
    provider.embed_query("机构应如何保存资料？")
    provider._model.query_embed.assert_called_once_with("为这个句子生成表示以用于检索相关文章：机构应如何保存资料？")
    provider.embed_documents(["制度正文"])
    provider._model.embed.assert_called_once_with(["制度正文"], batch_size=32)
