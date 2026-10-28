"""TXT 与 PDF 的逐页解析、选择性 OCR 及稳定分块。"""

from __future__ import annotations

import re
import tempfile
from bisect import bisect_left, bisect_right
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader

from app.services.ocr.ports import OCRProvider


STRUCTURE_RE = re.compile(r"第[零〇一二三四五六七八九十百千万0-9]+[章节条]")
CHUNK_SIZE = 500
OVERLAP = 50
MIN_BREAK = CHUNK_SIZE // 2


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


def _structural_sections(text: str) -> list[tuple[str, str | None]]:
    """在章、节、条处断开，并保留条号供引用定位。"""
    markers = []
    for match in STRUCTURE_RE.finditer(text):
        previous = match.start() - 1
        while previous >= 0 and text[previous] in " \t":
            previous -= 1
        if previous < 0 or text[previous] in "\n。；;":
            markers.append(match)
    if not markers:
        return [(text, None)]

    sections = []
    if text[:markers[0].start()].strip():
        sections.append((text[:markers[0].start()], None))
    article = None
    for index, match in enumerate(markers):
        if match.group().endswith("条"):
            article = match.group()
        else:
            article = None
        end = markers[index + 1].start() if index + 1 < len(markers) else len(text)
        sections.append((text[match.start():end], article))
    return sections


def _chunk_sections(section: str) -> list[str]:
    """优先在段落、表格行和标点处截断，超长语句最后按字符硬切。"""
    boundaries = (
        [match.end() for match in re.finditer(r"\n+", section)],
        [match.end() for match in re.finditer(r"[。！？!?；;]+", section)],
        [match.end() for match in re.finditer(r"[，、,:：]+", section)],
    )
    chunks = []
    start = 0
    while start < len(section):
        limit = min(start + CHUNK_SIZE, len(section))
        end = limit
        if limit < len(section):
            for tier in boundaries:
                index = bisect_right(tier, limit) - 1
                if index >= 0 and index >= bisect_left(tier, start + MIN_BREAK):
                    end = tier[index]
                    break
        text = section[start:end].strip()
        if text:
            chunks.append(text)
        if end == len(section):
            break
        start = end - OVERLAP
    return chunks


def parse_document(path: Path, *, ocr: OCRProvider | None = None) -> ParsedDocument:
    """逐页提取文本；配置 OCR 时仅识别无文字层的 PDF 页。"""
    suffix = path.suffix.lower()
    warnings: list[str] = []
    if suffix == ".pdf":
        reader = PdfReader(path)
        pages = []
        rendered_pdf = None
        try:
            for index, page in enumerate(reader.pages, start=1):
                content = page.extract_text() or ""
                if not content.strip() and ocr is not None:
                    try:
                        if rendered_pdf is None:
                            import pymupdf

                            rendered_pdf = pymupdf.open(path)
                        with tempfile.TemporaryDirectory(prefix="finrag-ocr-") as directory:
                            image_path = Path(directory) / "page.png"
                            rendered_pdf.load_page(index - 1).get_pixmap(dpi=150).save(image_path)
                            content = ocr.recognize(image_path)
                    except Exception as exc:
                        warnings.append(f"第 {index} 页 OCR 失败：{type(exc).__name__}：{exc}")
                    else:
                        if content.strip():
                            warnings.append(f"第 {index} 页经 OCR 识别，需人工复核")
                pages.append((index, content))
                if not content.strip():
                    warnings.append(
                        f"第 {index} 页 OCR 未获得可用文字" if ocr is not None
                        else f"第 {index} 页无可提取文字，尚需 OCR"
                    )
        finally:
            if rendered_pdf is not None:
                rendered_pdf.close()
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
        for section, article in _structural_sections(normalized):
            chunks.extend(
                ParsedChunk(text, page_number, article)
                for text in _chunk_sections(section)
            )
    if not chunks:
        if ocr is not None:
            failure = next((warning for warning in warnings if "OCR 失败" in warning), None)
            raise ValueError(f"文件没有可用文字；{failure or 'OCR 未获得可用文字'}")
        raise ValueError("文件没有可用文字；扫描件需先完成 OCR")
    return ParsedDocument(tuple(chunks), page_count, tuple(warnings))
