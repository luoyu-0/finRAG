"""TXT 与文字型 PDF 的原生解析及稳定分块。"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader


ARTICLE_RE = re.compile(r"第[零一二三四五六七八九十百千0-9]+条")
CHUNK_SIZE = 350
OVERLAP = 50


@dataclass(frozen=True)
class ParsedChunk:
    text: str
    page_number: int | None
    article_number: str | None


@dataclass(frozen=True)
class ParsedDocument:
    chunks: tuple[ParsedChunk, ...]
    page_count: int
    warnings: tuple[str, ...]


def parse_document(path: Path) -> ParsedDocument:
    """逐页提取文本；无文本层的 PDF 页保留告警供后续 OCR。"""
    suffix = path.suffix.lower()
    warnings: list[str] = []
    if suffix == ".pdf":
        reader = PdfReader(path)
        pages = []
        for index, page in enumerate(reader.pages, start=1):
            content = page.extract_text() or ""
            pages.append((index, content))
            if not content.strip():
                warnings.append(f"第 {index} 页无可提取文字，尚需 OCR")
        page_count = len(pages)
    elif suffix == ".txt":
        data = path.read_bytes()
        try:
            content = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            content = data.decode("gb18030")
            warnings.append("文本按 GB18030 编码解析")
        pages = [(None, content)]
        page_count = 0
    else:
        raise ValueError("仅支持 TXT 和 PDF")

    chunks: list[ParsedChunk] = []
    for page_number, content in pages:
        normalized = re.sub(r"[ \t]+", " ", content.replace("\r\n", "\n"))
        normalized = re.sub(r"\n{3,}", "\n\n", normalized).strip()
        matches = list(ARTICLE_RE.finditer(normalized))
        sections = []
        if matches and normalized[:matches[0].start()].strip():
            sections.append((normalized[:matches[0].start()], None))
        for index, match in enumerate(matches):
            end = matches[index + 1].start() if index + 1 < len(matches) else len(normalized)
            sections.append((normalized[match.start():end], match.group()))
        if not matches:
            sections.append((normalized, None))
        for section, article in sections:
            position = 0
            while position < len(section):
                end = min(position + CHUNK_SIZE, len(section))
                if end < len(section):
                    boundary = section.rfind("\n", position + CHUNK_SIZE // 2, end)
                    if boundary > position:
                        end = boundary + 1
                text = section[position:end].strip()
                if text:
                    chunks.append(ParsedChunk(text, page_number, article))
                if end == len(section):
                    break
                position = max(position + 1, end - OVERLAP)
    if not chunks:
        raise ValueError("文件没有可用文字；扫描件需先完成 OCR")
    return ParsedDocument(tuple(chunks), page_count, tuple(warnings))
