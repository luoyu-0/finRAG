"""带引用标签的上下文组装。"""

from __future__ import annotations

from collections.abc import Sequence

from app.domain.rag import ContextItem, ContextPackage, FusedHit


class ContextAssembler:
    """在固定字符与条目预算内组装上下文。"""

    def __init__(self, max_chars: int = 12_000, max_chunks: int = 8) -> None:
        if max_chars < 200:
            raise ValueError("max_chars 不能小于 200")
        if max_chunks < 1:
            raise ValueError("max_chunks 必须大于 0")
        self._max_chars = max_chars
        self._max_chunks = max_chunks

    def assemble(self, hits: Sequence[FusedHit]) -> ContextPackage:
        """按相关性顺序生成 S1、S2 等稳定标签。"""

        items: list[ContextItem] = []
        rendered_blocks: list[str] = []
        used_chars = 0
        truncated = len(hits) > self._max_chunks

        for hit in hits[: self._max_chunks]:
            label = f"S{len(items) + 1}"
            header = self._render_header(label, hit)
            separator_size = 2 if rendered_blocks else 0
            remaining = self._max_chars - used_chars - separator_size
            block = f"{header}\n内容：{hit.text}"

            if len(block) <= remaining:
                rendered = block
            else:
                available_text = remaining - len(header) - len("\n内容：") - 1
                if available_text < 50:
                    truncated = True
                    break
                rendered = f"{header}\n内容：{hit.text[:available_text]}…"
                truncated = True

            items.append(ContextItem(label=label, hit=hit, rendered_text=rendered))
            rendered_blocks.append(rendered)
            used_chars += len(rendered) + separator_size
            if truncated:
                break

        return ContextPackage(
            text="\n\n".join(rendered_blocks),
            items=tuple(items),
            truncated=truncated,
        )

    @staticmethod
    def _render_header(label: str, hit: FusedHit) -> str:
        source = hit.source
        location = [f"文件：{source.title}"]
        if source.page_number is not None:
            location.append(f"页码：{source.page_number}")
        if source.article_number:
            location.append(f"条文：{source.article_number}")
        return f"[{label}]\n" + "；".join(location)
