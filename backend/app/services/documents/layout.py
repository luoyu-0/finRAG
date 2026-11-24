"""PDF 页面的行、段落和表格清洗规则。

这里只处理与具体 PDF 库无关的纯文本和版式判断，方便单元测试；
PyMuPDF 的读取与 OCR 渲染留在 ``native_import``。
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from statistics import median

# 页眉、页脚所在的版面比例。制度文件正文很少占用页面最上/最下 12%。
MARGIN_RATIO = 0.12
# 连续页码的常见写法：- 1 -、第 1 页、1/10、Page 1 of 10。
PAGE_NUMBER_RE = re.compile(
    r"^(?:[-—–]\s*)?\d{1,4}\s*(?:[-—–])?$"
    r"|^第\s*\d+\s*页(?:\s*[/，,]\s*共\s*\d+\s*页)?$"
    r"|^\d+\s*/\s*\d+$"
    r"|^page\s*\d+(?:\s*(?:of|/)\s*\d+)?$",
    re.IGNORECASE,
)
# 新的章、节、条、列表项或附件开始，不应与上一页末段拼接。
STRUCTURAL_START_RE = re.compile(
    r"^(?:第[零〇一二三四五六七八九十百千万0-9]+[章节条]"
    r"|[一二三四五六七八九十]+、|（[一二三四五六七八九十]+）"
    r"|\d+[.、]|[（(]\d+[）)]|附[件录]|表\s*\d|注\s*[:：]|数据来源|目\s*录)"
)
SENTENCE_END = "。！？!?；;"
PAUSE_END = "，、,：:"
TEXT_TAIL_RE = re.compile(r"[0-9A-Za-z\u4e00-\u9fff]$")


@dataclass(frozen=True)
class TextLine:
    """一行文字及其在页面中的归一化位置（0–1）。"""

    text: str
    top: float
    bottom: float
    left: float = 0.0
    confidence: float | None = None

    @property
    def margin(self) -> bool:
        return self.top < MARGIN_RATIO or self.bottom > 1 - MARGIN_RATIO


def normalize_line(text: str) -> str:
    """忽略空白差异比较页眉页脚，中文排版常在不同页插入空格。"""
    return re.sub(r"\s+", "", text)


def is_page_number(text: str) -> bool:
    return bool(PAGE_NUMBER_RE.fullmatch(text.strip()))


def margin_noise(pages: list[list[TextLine]]) -> set[str]:
    """找出在多页页眉/页脚重复出现的短行。

    只统计页面上、下边缘，避免把正文中重复的“第一条”等短语当成噪声。
    两页文档重复出现两次即视为页眉；三页及以上要求至少出现三次。
    """
    if not pages:
        return set()
    threshold = 3 if len(pages) >= 3 else 2
    counts: Counter[str] = Counter()
    for lines in pages:
        seen: set[str] = set()
        for line in lines:
            if not line.margin:
                continue
            key = normalize_line(line.text)
            if not key or len(key) > 80 or is_page_number(line.text) or key in seen:
                continue
            seen.add(key)
            counts[key] += 1
    return {key for key, count in counts.items() if count >= threshold}


def is_noise_line(line: TextLine, noise: set[str]) -> bool:
    """仅在上下边缘移除重复页眉/页脚和页码，正文同文内容保留。"""
    key = normalize_line(line.text)
    if not key:
        return True
    return line.margin and (key in noise or is_page_number(line.text))


def join_lines(parts: list[str]) -> str:
    """拼接被 PDF 换行拆开的同一段文字，保留英文单词间空格。"""
    result = ""
    for raw in parts:
        text = raw.strip()
        if not text:
            continue
        if not result:
            result = text
            continue
        previous, following = result[-1], text[0]
        if previous == "-" and following.isascii() and following.isalpha():
            result = result[:-1] + text
        elif (
            previous.isascii()
            and previous.isalnum()
            and following.isascii()
            and following.isalnum()
        ):
            result += " " + text
        else:
            result += text
    return re.sub(r"[ \t]+", " ", result).strip()


def should_join_paragraph(previous: str, following: str) -> bool:
    """判断页边界两侧是否属于同一自然段。

    只在上一段没有句末标点、下一段不是新结构时拼接；否则宁可少拼，
    避免把两条独立制度或章节标题粘在一起。
    """
    previous, following = previous.strip(), following.strip()
    if not previous or not following:
        return False
    if is_page_number(following) or STRUCTURAL_START_RE.match(following):
        return False
    # 表格行与正文段落不应跨页拼接。
    if " | " in previous:
        return False
    if previous[-1] in SENTENCE_END:
        return False
    if previous[-1] in PAUSE_END:
        return True
    # 以冒号结尾通常引出列表，不跨页拼接。
    if previous[-1] in ":：":
        return False
    # 标题、图表标题通常较短，宁可拆开。
    if len(previous) < 8:
        return False
    return bool(TEXT_TAIL_RE.search(previous))


def paragraphs_from_blocks(blocks: list[list[TextLine]], noise: set[str]) -> list[str]:
    """每个 PDF 文本块视为一个自然段，清理噪声行后拼接块内换行。"""
    paragraphs = []
    for lines in blocks:
        text = join_lines([line.text for line in lines if not is_noise_line(line, noise)])
        if text:
            paragraphs.append(text)
    return paragraphs


def paragraphs_from_lines(lines: list[TextLine], noise: set[str]) -> list[str]:
    """OCR 只有行没有块：按行距分组，再合并句中断行。"""
    kept = sorted(
        (line for line in lines if not is_noise_line(line, noise)),
        key=lambda line: (line.top, line.left),
    )
    if not kept:
        return []
    heights = [line.bottom - line.top for line in kept if line.bottom > line.top]
    gap_limit = max(0.015, median(heights) * 0.8) if heights else 0.02
    groups: list[list[TextLine]] = [[kept[0]]]
    for previous, line in zip(kept, kept[1:]):
        if line.top - previous.bottom > gap_limit or STRUCTURAL_START_RE.match(line.text):
            groups.append([line])
        else:
            groups[-1].append(line)
    paragraphs = [join_lines([line.text for line in group]) for group in groups]
    merged: list[str] = []
    for paragraph in paragraphs:
        if merged and should_join_paragraph(merged[-1], paragraph):
            merged[-1] = join_lines([merged[-1], paragraph])
        else:
            merged.append(paragraph)
    return merged


def merge_across_pages(pages: list[tuple[int, list[str]]]) -> list[tuple[int, list[str]]]:
    """把上一页末段与下一页首段拼成一个自然段，归属起始页。"""
    merged: list[list] = []
    for page_number, paragraphs in pages:
        paragraphs = [paragraph for paragraph in paragraphs if paragraph.strip()]
        if merged and paragraphs and should_join_paragraph(merged[-1][1][-1], paragraphs[0]):
            merged[-1][1][-1] = join_lines([merged[-1][1][-1], paragraphs[0]])
            paragraphs = paragraphs[1:]
        if paragraphs:
            merged.append([page_number, paragraphs])
    return [(page_number, paragraphs) for page_number, paragraphs in merged]


def table_rows_to_text(rows: list[list[str | None]]) -> str:
    """把 PyMuPDF 表格行转成便于分块的竖线分隔文本。"""
    lines = []
    for row in rows:
        cells = [
            re.sub(r"\s*\n\s*", " ", str(cell)).strip() if cell is not None else ""
            for cell in row
        ]
        while cells and not cells[-1]:
            cells.pop()
        if any(cells):
            lines.append(" | ".join(cells))
    return "\n".join(lines)


def block_overlaps_table(
    block_bbox: tuple[float, float, float, float],
    table_bboxes: list[tuple[float, float, float, float]],
    threshold: float = 0.35,
) -> bool:
    """文本块大部分落在表格内时不再重复计入正文。"""
    block_area = max((block_bbox[2] - block_bbox[0]) * (block_bbox[3] - block_bbox[1]), 1.0)
    for table_bbox in table_bboxes:
        width = max(0.0, min(block_bbox[2], table_bbox[2]) - max(block_bbox[0], table_bbox[0]))
        height = max(0.0, min(block_bbox[3], table_bbox[3]) - max(block_bbox[1], table_bbox[1]))
        if width * height / block_area >= threshold:
            return True
    return False
