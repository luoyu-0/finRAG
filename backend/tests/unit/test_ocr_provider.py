"""PaddleOCR 适配器的行坐标与置信度映射测试。"""

import tempfile
import unittest
from pathlib import Path

import pymupdf

from app.services.ocr.paddle import PaddleOCRProvider


class FakeEngine:
    def predict(self, image_path):
        return [{
            "rec_texts": ["第一条 机构应当", "保存业务记录。"],
            "rec_boxes": [[10, 20, 300, 40], [10, 50, 300, 70]],
            "rec_scores": [0.92, 0.88],
        }]


class PaddleOCRProviderTests(unittest.TestCase):
    def test_result_keeps_normalized_positions_and_confidence(self):
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / "page.png"
            with pymupdf.open() as document:
                page = document.new_page(width=400, height=800)
                page.get_pixmap().save(image_path)

            provider = PaddleOCRProvider()
            provider._engine = FakeEngine()
            result = provider.recognize_result(image_path)

        self.assertEqual(result.text, "第一条 机构应当\n保存业务记录。")
        self.assertEqual(len(result.lines), 2)
        self.assertAlmostEqual(result.lines[0].top, 20 / 800)
        self.assertAlmostEqual(result.lines[0].bottom, 40 / 800)
        self.assertAlmostEqual(result.lines[0].left, 10 / 400)
        self.assertAlmostEqual(result.mean_confidence, 0.9)

    def test_polygon_fallback_when_boxes_are_missing(self):
        class PolygonEngine:
            def predict(self, image_path):
                return [{
                    "rec_texts": ["正文"],
                    "rec_polys": [[[10, 20], [100, 20], [100, 40], [10, 40]]],
                    "rec_scores": [0.8],
                }]

        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / "page.png"
            with pymupdf.open() as document:
                document.new_page(width=200, height=400).get_pixmap().save(image_path)

            provider = PaddleOCRProvider()
            provider._engine = PolygonEngine()
            result = provider.recognize_result(image_path)

        self.assertEqual(result.lines[0].text, "正文")
        self.assertAlmostEqual(result.lines[0].top, 20 / 400)


if __name__ == "__main__":
    unittest.main()
