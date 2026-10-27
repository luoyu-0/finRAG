"""PaddleOCR 图片文字识别适配器，仅在离线导入时加载轻量模型。"""

from pathlib import Path


class PaddleOCRProvider:
    def __init__(self) -> None:
        self._engine = None

    def recognize(self, image_path: Path) -> str:
        if self._engine is None:
            from paddleocr import PaddleOCR

            self._engine = PaddleOCR(
                lang="ch",
                ocr_version="PP-OCRv5",
                text_detection_model_name="PP-OCRv5_mobile_det",
                text_recognition_model_name="PP-OCRv5_mobile_rec",
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
                enable_mkldnn=False,
            )
        result = self._engine.predict(str(image_path))
        return "\n".join(
            text
            for page in result or []
            for text in page.get("rec_texts", [])
            if isinstance(text, str) and text.strip()
        )
