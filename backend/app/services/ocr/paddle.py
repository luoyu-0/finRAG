"""PaddleOCR 图片文字识别适配器，仅在离线导入时加载轻量模型。"""

from __future__ import annotations

from pathlib import Path

from app.services.ocr.ports import OCRLine, OCRResult


class PaddleOCRProvider:
    def __init__(self) -> None:
        self._engine = None

    def _ensure_engine(self):
        if self._engine is None:
            from paddleocr import PaddleOCR

            self._engine = PaddleOCR(
                lang="ch",
                ocr_version="PP-OCRv5",
                text_detection_model_name="PP-OCRv5_mobile_det",
                text_recognition_model_name="PP-OCRv5_mobile_rec",
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                # 扫描件常出现旋转文字，开启行方向分类可减少整行漏识。
                use_textline_orientation=True,
                enable_mkldnn=False,
            )
        return self._engine

    def recognize(self, image_path: Path) -> str:
        return self.recognize_result(image_path).text

    def recognize_result(self, image_path: Path) -> OCRResult:
        """返回逐行文字、归一化坐标和平均置信度，供版面清洗与复核告警。"""
        result = self._ensure_engine().predict(str(image_path))
        width, height = _image_size(image_path)
        lines: list[OCRLine] = []
        scores: list[float] = []
        for page in result or []:
            texts = page.get("rec_texts") or []
            boxes = page.get("rec_boxes")
            polygons = page.get("rec_polys")
            page_scores = page.get("rec_scores") or []
            for index, text in enumerate(texts):
                if not isinstance(text, str) or not text.strip():
                    continue
                score = _number(page_scores[index]) if index < len(page_scores) else None
                if score is not None:
                    scores.append(score)
                box = _box_at(boxes, polygons, index)
                if box is None or width <= 0 or height <= 0:
                    step = 1 / max(len(texts), 1)
                    top, bottom, left = index * step, (index + 1) * step, 0.0
                else:
                    x0, y0, x1, y1 = box
                    top, bottom, left = y0 / height, y1 / height, x0 / width
                lines.append(OCRLine(text.strip(), top, bottom, left, score))
        lines.sort(key=lambda line: (line.top, line.left))
        mean_confidence = sum(scores) / len(scores) if scores else None
        return OCRResult(
            text="\n".join(line.text for line in lines),
            lines=tuple(lines),
            mean_confidence=mean_confidence,
        )


def _number(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _box_at(boxes, polygons, index: int) -> tuple[float, float, float, float] | None:
    if boxes is not None and index < len(boxes):
        box = boxes[index]
        if len(box) >= 4:
            x0, y0, x1, y1 = (_number(value) for value in box[:4])
            if None not in (x0, y0, x1, y1):
                return float(x0), float(y0), float(x1), float(y1)
    if polygons is not None and index < len(polygons):
        points = polygons[index]
        xs = [_number(point[0]) for point in points]
        ys = [_number(point[1]) for point in points]
        if points is not None and all(value is not None for value in [*xs, *ys]):
            return min(xs), min(ys), max(xs), max(ys)
    return None


def _image_size(image_path: Path) -> tuple[float, float]:
    """用 PyMuPDF 读取渲染图尺寸，失败时退回 0 表示位置不可用。"""
    try:
        import pymupdf

        # OCR 框是图像像素坐标，必须用像素尺寸而不是按 72dpi 换算的页面尺寸。
        pixmap = pymupdf.Pixmap(str(image_path))
        return float(pixmap.width), float(pixmap.height)
    except Exception:
        return 0.0, 0.0
