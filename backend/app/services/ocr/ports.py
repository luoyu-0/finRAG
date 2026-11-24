"""OCR 识别端口与识别结果结构。"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True)
class OCRLine:
    """一行识别文字及其在页面中的归一化位置（0–1）。"""

    text: str
    top: float
    bottom: float
    left: float = 0.0
    confidence: float | None = None


@dataclass(frozen=True)
class OCRResult:
    text: str
    lines: tuple[OCRLine, ...] = ()
    mean_confidence: float | None = None


class OCRProvider(Protocol):
    def recognize(self, image_path: Path) -> str: ...


class DetailedOCRProvider(OCRProvider, Protocol):
    """可选能力：返回行坐标与置信度，供版式清洗和人工复核告警使用。"""

    def recognize_result(self, image_path: Path) -> OCRResult: ...
