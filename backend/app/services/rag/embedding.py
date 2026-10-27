"""BGE 中文 Embedding 适配器。"""

from __future__ import annotations

from fastembed import TextEmbedding


MODEL_NAME = "BAAI/bge-small-zh-v1.5"
MODEL_DIMENSION = 512


class BgeEmbeddingProvider:
    """将本地 ONNX 推理封装在检索与导入之外。"""

    def __init__(self, cache_dir: str = "/opt/models") -> None:
        self._model = TextEmbedding(
            model_name=MODEL_NAME, cache_dir=cache_dir, local_files_only=True,
        )

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [vector.tolist() for vector in self._model.embed(texts, batch_size=32)]

    def embed_query(self, question: str) -> list[float]:
        return next(iter(self._model.query_embed(question))).tolist()
