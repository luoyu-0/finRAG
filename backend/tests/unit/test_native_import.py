"""原生文本导入的边界测试。"""

import tempfile
import unittest
from pathlib import Path

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from app.services.documents.native_import import _chunk_sections, parse_document


class NativeImportTests(unittest.TestCase):
    def test_txt_chunks_keep_article_location(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "制度.txt"
            path.write_text("第一条 " + "机构应保存记录。" * 90, encoding="utf-8")
            parsed = parse_document(path)
        self.assertGreater(len(parsed.chunks), 1)
        self.assertTrue(all(chunk.article_number == "第一条" for chunk in parsed.chunks))
        self.assertTrue(all(chunk.page_number is None for chunk in parsed.chunks))

    def test_does_not_assign_later_article_to_earlier_text(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "制度.txt"
            path.write_text("第一条 保存记录。第二条 定期报告。", encoding="utf-8")
            parsed = parse_document(path)
        self.assertEqual([chunk.article_number for chunk in parsed.chunks], ["第一条", "第二条"])

    def test_chapter_section_and_article_keep_distinct_locations(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "制度.txt"
            path.write_text(
                "制度标题\n第一章 总则\n第一节 适用范围\n第一条 机构应保存记录。\n第二条 机构应定期报告。",
                encoding="utf-8",
            )
            parsed = parse_document(path)
        self.assertEqual(
            [chunk.article_number for chunk in parsed.chunks],
            [None, None, None, "第一条", "第二条"],
        )

    def test_long_paragraph_uses_punctuation_then_fifty_character_overlap(self) -> None:
        sentence = "机构应当核对业务记录。"
        chunks = _chunk_sections(sentence * 60)
        self.assertTrue(all(len(chunk) <= 500 for chunk in chunks))
        self.assertTrue(all(left[-50:] == right[:50] for left, right in zip(chunks, chunks[1:])))
        self.assertTrue(all(chunk.endswith("。") for chunk in chunks[:-1]))

    def test_unbroken_text_falls_back_to_hard_cut(self) -> None:
        chunks = _chunk_sections("甲" * 1100)
        self.assertEqual([len(chunk) for chunk in chunks], [500, 500, 200])
        self.assertTrue(all(left[-50:] == right[:50] for left, right in zip(chunks, chunks[1:])))

    def test_comma_is_used_when_no_paragraph_or_sentence_boundary_exists(self) -> None:
        chunks = _chunk_sections("甲" * 320 + "，" + "乙" * 400)
        self.assertEqual(len(chunks[0]), 321)
        self.assertTrue(all(len(chunk) <= 500 for chunk in chunks))

    def test_table_rows_are_preferred_to_hard_cut(self) -> None:
        row = "项目|数值|说明\n"
        chunks = _chunk_sections(row * 70)
        self.assertTrue(all(len(chunk) <= 500 for chunk in chunks))
        self.assertTrue(chunks[0].endswith("说明"))

    def test_rejects_empty_text(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "空.txt"
            path.write_text(" \n ", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "没有可用文字"):
                parse_document(path)

    def test_text_pdf_keeps_page_number(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "制度.pdf"
            writer = PdfWriter()
            page = writer.add_blank_page(width=612, height=792)
            font = DictionaryObject({
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Helvetica"),
            })
            page[NameObject("/Resources")] = DictionaryObject({
                NameObject("/Font"): DictionaryObject({
                    NameObject("/F1"): writer._add_object(font),
                }),
            })
            stream = DecodedStreamObject()
            stream.set_data(b"BT /F1 12 Tf 50 700 Td (Bank record retention policy) Tj ET")
            page[NameObject("/Contents")] = writer._add_object(stream)
            with path.open("wb") as output:
                writer.write(output)
            class UnexpectedOCR:
                def recognize(self, image_path: Path) -> str:
                    raise AssertionError("文字型 PDF 不应调用 OCR")

            parsed = parse_document(path, ocr=UnexpectedOCR())
        self.assertEqual(parsed.page_count, 1)
        self.assertEqual(parsed.chunks[0].page_number, 1)
        self.assertIn("Bank record retention", parsed.chunks[0].text)

    def test_scanned_pdf_page_uses_ocr_and_keeps_page_number(self) -> None:
        class StubOCR:
            calls = 0
            image_existed = False

            def recognize(self, image_path: Path) -> str:
                self.calls += 1
                self.image_existed = image_path.is_file()
                return "第一条 扫描页内容。"

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "扫描制度.pdf"
            writer = PdfWriter()
            writer.add_blank_page(width=612, height=792)
            with path.open("wb") as output:
                writer.write(output)
            ocr = StubOCR()
            parsed = parse_document(path, ocr=ocr)

        self.assertEqual(ocr.calls, 1)
        self.assertTrue(ocr.image_existed)
        self.assertEqual(parsed.chunks[0].page_number, 1)
        self.assertEqual(parsed.chunks[0].article_number, "第一条")
        self.assertIn("OCR", parsed.warnings[0])
