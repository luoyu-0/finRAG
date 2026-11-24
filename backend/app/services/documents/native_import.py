"""TXT、PDF 的逐页解析、选择性 OCR、版式清洗及稳定分块。"""

from __future__ import annotations

import re
import tempfile
from bisect import bisect_left, bisect_right
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree
from zipfile import ZipFile

from app.services.documents.layout import (
    PageText,
    TextLine,
    is_noise_line,
    join_lines,
    line_inside_table,
    margin_noise,
    merge_across_pages,
    paragraphs_from_lines,
    table_rows_to_text,
)
from app.services.ocr.ports import OCRProvider, OCRResult


STRUCTURE_RE = re.compile(r"第[零〇一二三四五六七八九十百千万0-9]+[章节条]")
HEADING_RE = re.compile(r"第[零〇一二三四五六七八九十百千万0-9]+[章节][^\n。！？；;：:《》“”]{0,80}\Z")
# 附件、附录及表格标题只在行首作为结构边界。
OTHER_HEADING = (
    r"(?:附[件录](?=[ \t\n一二三四五六七八九十甲乙丙丁戊己庚辛壬癸\d：:（(]|$"
    r"|[A-ZＡ-Ｚ]+(?=[ \t\n.．、：:（(]|$))|表[ \t]*\d+)"
)
PDF_STRUCTURE_RE = re.compile(rf"{STRUCTURE_RE.pattern}|^[ \t]*{OTHER_HEADING}", re.MULTILINE)
PDF_STRUCTURAL_LINE_RE = re.compile(rf"^(?:{STRUCTURE_RE.pattern}|{OTHER_HEADING})")
CHUNK_SIZE = 500
OVERLAP = 50
MIN_BREAK = CHUNK_SIZE // 2
OCR_DPI = 220
LOW_OCR_CONFIDENCE = 0.75


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


def _structural_sections(text: str, *, paged: bool = False) -> list[tuple[str, str | None]]:
    """在结构标记处断开，并保留条号供引用定位。"""
    markers = []
    pattern = PDF_STRUCTURE_RE if paged else STRUCTURE_RE
    for match in pattern.finditer(text):
        previous = match.start() - 1
        while previous >= 0 and text[previous].isspace() and text[previous] != "\n":
            previous -= 1
        # 网页导出的章标题可能与首条正文粘连，标题内没有句末标点。
        after_heading = bool(markers and HEADING_RE.fullmatch(text[markers[-1].start():match.start()].strip()))
        if previous < 0 or text[previous] in "\n。；;" or after_heading:
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


def infer_single_article(text: str) -> str | None:
    """仅为章标题后单条正文推断条号；多条混合或前置正文不作猜测。"""
    sections = _structural_sections(text.strip())
    articles = {article for _, article in sections if article}
    if len(articles) != 1:
        return None
    if any(not article and not HEADING_RE.fullmatch(section.strip()) for section, article in sections):
        return None
    return next(iter(articles))


def _chunk_sections(section: str) -> list[tuple[int, str]]:
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
        fragment = section[start:end]
        text = fragment.lstrip()
        if text:
            chunks.append((end - len(text), text.rstrip()))
        if end == len(section):
            break
        start = end - OVERLAP
    return chunks


def _page_text_blocks(page) -> tuple[list[tuple[tuple[float, float, float, float], list[TextLine]]], list[TextLine]]:
    """读取页面文本块和行；保留 bbox 供表格去重及页眉页脚判断。"""
    width = max(page.rect.width, 1.0)
    height = max(page.rect.height, 1.0)
    data = page.get_text("dict")
    blocks = []
    all_lines: list[TextLine] = []
    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue
        lines = []
        for line in block.get("lines", []):
            text = "".join(span.get("text", "") for span in line.get("spans", [])).strip()
            if not text:
                continue
            bbox = tuple(line["bbox"])
            x0, y0, _x1, y1 = bbox
            item = TextLine(text, y0 / height, y1 / height, x0 / width, bbox=bbox)
            lines.append(item)
            all_lines.append(item)
        if lines:
            blocks.append((tuple(block["bbox"]), lines))
    return blocks, all_lines


def _page_tables(page) -> list[tuple[tuple[float, float, float, float], str]]:
    """提取页面表格并转成文本；没有表格或解析失败时返回空列表。"""
    try:
        finder = page.find_tables()
    except Exception:
        return []
    tables = []
    for table in getattr(finder, "tables", []):
        try:
            rows = table.extract()
        except Exception:
            continue
        # 封面标题常被识别成只有一行的“表格”，不应拆成竖线字段。
        if len(rows) < 2:
            continue
        text = table_rows_to_text(rows)
        if text:
            tables.append((tuple(table.bbox), text))
    return tables


def _ocr_lines(text: str) -> tuple[TextLine, ...]:
    """兼容只返回字符串的测试替身，按行给出近似版面位置。"""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return ()
    step = 1 / len(lines)
    return tuple(
        TextLine(line, index * step, (index + 1) * step)
        for index, line in enumerate(lines)
    )


def _layout_lines(result: OCRResult) -> list[TextLine]:
    """把 OCR 端口返回的行坐标转成版式清洗统一使用的类型。"""
    return [
        TextLine(line.text, line.top, line.bottom, line.left, line.confidence)
        for line in result.lines
    ]


def _run_ocr(ocr: OCRProvider, image_path: Path) -> OCRResult:
    detailed = getattr(ocr, "recognize_result", None)
    if callable(detailed):
        return detailed(image_path)
    text = ocr.recognize(image_path)
    return OCRResult(text=text, lines=_ocr_lines(text))


def _parse_pdf(path: Path, ocr: OCRProvider | None, warnings: list[str]) -> tuple[list[PageText], int]:
    import pymupdf

    raw_pages = []
    with pymupdf.open(path) as document:
        for index, page in enumerate(document.pages(), start=1):
            blocks, lines = _page_text_blocks(page)
            tables = _page_tables(page) if lines else []
            if lines:
                raw_pages.append({"number": index, "blocks": blocks, "lines": lines, "tables": tables})
                continue

            content = ""
            if ocr is not None:
                try:
                    with tempfile.TemporaryDirectory(prefix="finrag-ocr-") as directory:
                        image_path = Path(directory) / "page.png"
                        page.get_pixmap(dpi=OCR_DPI).save(image_path)
                        result = _run_ocr(ocr, image_path)
                        content = result.text or ""
                        lines = _layout_lines(result) or _ocr_lines(content)
                except Exception as exc:
                    warnings.append(f"第 {index} 页 OCR 失败：{type(exc).__name__}：{exc}")
                else:
                    if content.strip():
                        warnings.append(f"第 {index} 页经 OCR 识别，需人工复核")
                        _warn_ocr_quality(index, content, result, warnings)
                    else:
                        warnings.append(f"第 {index} 页 OCR 未获得可用文字")
            if not content.strip() and not lines:
                warnings.append(
                    f"第 {index} 页无可提取文字，尚需 OCR" if ocr is None
                    else f"第 {index} 页 OCR 未获得可用文字"
                )
            # 有文字但无版式信息的 OCR 结果也保留，后续统一做页眉页脚判断。
            raw_pages.append({"number": index, "blocks": [], "lines": lines, "tables": []})

    noise = margin_noise([page["lines"] for page in raw_pages])
    if noise:
        warnings.append(f"已清理 {len(noise)} 条重复页眉或页脚")

    pages = []
    for page in raw_pages:
        if page["blocks"]:
            paragraphs = _page_paragraphs(page["blocks"], page["tables"], noise)
        else:
            paragraphs = paragraphs_from_lines(page["lines"], noise)
        if paragraphs:
            pages.append((page["number"], [_normalize_text(paragraph) for paragraph in paragraphs]))
    return merge_across_pages(pages), len(raw_pages)


def _warn_ocr_quality(index: int, content: str, result: OCRResult, warnings: list[str]) -> None:
    if result.mean_confidence is not None and result.mean_confidence < LOW_OCR_CONFIDENCE:
        warnings.append(f"第 {index} 页 OCR 平均置信度 {result.mean_confidence:.2f}，需人工复核")
    if len(content.strip()) < 20:
        warnings.append(f"第 {index} 页 OCR 识别文字较少，需人工复核")


def _page_paragraphs(
    blocks: list[tuple[tuple[float, float, float, float], list[TextLine]]],
    tables: list[tuple[tuple[float, float, float, float], str]],
    noise: set[str],
) -> list[str]:
    """按纵坐标合并表格和正文块，表格区域不重复计入正文。"""
    table_bboxes = [bbox for bbox, _ in tables]
    items = []
    for bbox, lines in blocks:
        kept_lines = [
            line for line in lines
            if not is_noise_line(line, noise)
            and not (table_bboxes and line.bbox and line_inside_table(line.bbox, table_bboxes))
        ]
        groups: list[list[str]] = []
        for line in kept_lines:
            if not groups or PDF_STRUCTURAL_LINE_RE.match(line.text):
                groups.append([])
            groups[-1].append(line.text)
        if groups:
            first_bbox = kept_lines[0].bbox or bbox
            items.append((first_bbox[1], first_bbox[0], "\n".join(join_lines(group) for group in groups)))
    for bbox, text in tables:
        items.append((bbox[1], bbox[0], text))
    items.sort(key=lambda item: (item[0], item[1]))
    return [text for _, _, text in items]


def _normalize_text(content: str) -> str:
    normalized = re.sub(r"[ \t]+", " ", content.replace("\r\n", "\n"))
    return re.sub(r"\n{3,}", "\n\n", normalized).strip()


def _chunks_from_pages(pages: list[PageText]) -> list[ParsedChunk]:
    """按分块的首个正文字符定位原页，只在连续页之间继承条号。"""
    chunks: list[ParsedChunk] = []
    last_article: str | None = None
    previous_page: int | None = None
    for page in pages:
        offsets = [offset for offset, _ in page.page_starts]
        if offsets:
            if previous_page is None or page.page_starts[0][1] not in (previous_page, previous_page + 1):
                last_article = None
            previous_page = page.page_starts[-1][1]
        section_start = 0
        for section, article in _structural_sections(page.text, paged=bool(offsets)):
            if article is not None or PDF_STRUCTURAL_LINE_RE.match(section):
                last_article = article
            elif offsets:
                article = last_article
            for start, text in _chunk_sections(section):
                page_index = bisect_right(offsets, section_start + start) - 1
                page_number = page.page_starts[page_index][1] if offsets else None
                chunks.append(ParsedChunk(text, page_number, article))
            section_start += len(section)
    return chunks


def parse_document(path: Path, *, ocr: OCRProvider | None = None) -> ParsedDocument:
    """解析文件；PDF 使用版式清洗，OCR 仅用于无文字层页面。"""
    suffix = path.suffix.lower()
    warnings: list[str] = []
    if suffix == ".pdf":
        pages, page_count = _parse_pdf(path, ocr, warnings)
    elif suffix == ".docx":
        # 只读 Word 主文档的段落和表格文字，限制解压大小。
        with ZipFile(path) as archive:
            member = archive.getinfo("word/document.xml")
            if member.file_size > 50 * 1024 * 1024:
                raise ValueError("DOCX 解压后正文超过 50 MB")
            root = ElementTree.fromstring(archive.read(member))
        ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
        content = "\n".join(
            "".join(node.text or "" for node in para.iter(ns + "t"))
            for para in root.iter(ns + "p")
        )
        pages = [PageText(_normalize_text(content))]
        page_count = 0
    elif suffix in {".png", ".jpg", ".jpeg"}:
        if ocr is None:
            raise ValueError("图片需要启用 OCR 才能导入")
        result = _run_ocr(ocr, path)
        content = result.text or ""
        pages = [PageText(_normalize_text(content), ((0, 1),))]
        page_count = 1
        warnings.append("第 1 页经 OCR 识别，需人工复核")
        _warn_ocr_quality(1, content, result, warnings)
    elif suffix in {".txt", ".md"}:
        data = path.read_bytes()
        try:
            content = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            content = data.decode("gb18030")
            warnings.append("文本按 GB18030 编码解析")
        pages = [PageText(_normalize_text(content))]
        page_count = 0
    else:
        raise ValueError("仅支持 TXT、PDF、DOCX 和图片")

    chunks = _chunks_from_pages(pages)
    if not chunks:
        if ocr is not None:
            failure = next((warning for warning in warnings if "OCR 失败" in warning), None)
            raise ValueError(f"文件没有可用文字；{failure or 'OCR 未获得可用文字'}")
        raise ValueError("文件没有可用文字；扫描件需先完成 OCR")
    return ParsedDocument(tuple(chunks), page_count, tuple(warnings))
