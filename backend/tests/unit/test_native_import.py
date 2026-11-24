"""原生文本导入的边界测试。"""

import tempfile
import unittest
from pathlib import Path

import pymupdf
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from app.services.documents.layout import PageText
from app.services.documents.native_import import _chunk_sections, _chunks_from_pages, _structural_sections, infer_single_article, parse_document
from app.services.ocr.ports import OCRLine, OCRResult


class NativeImportTests(unittest.TestCase):
    def test_backfill_does_not_guess_ambiguous_locations(self):
        self.assertEqual(infer_single_article("第二章 标题 第六条 正文按第七条执行。"), "第六条")
        self.assertIsNone(infer_single_article("说明文字。第六条 正文。"))
        self.assertIsNone(infer_single_article("第六条 正文。第七条 另一条。"))
        self.assertIsNone(infer_single_article("按第七条执行。"))

    def test_inline_chapter_heading_preserves_article_number(self) -> None:
        for text in ("第二章 设立与终止 第六条 机构应取得许可。", "第二章\u00a0 征信机构第五条\u00a0 本条例所称机构。"):
            sections = _structural_sections(text)
            self.assertIsNotNone(sections[-1][1])
            self.assertEqual(len(sections), 2)

    def test_article_reference_inside_body_is_not_a_heading(self) -> None:
        sections = _structural_sections("第一条 应按本办法第六条规定办理，不得违反第七条。")
        self.assertEqual(len(sections), 1)
        self.assertEqual(sections[0][1], "第一条")

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
        chunks = [text for _, text in _chunk_sections(sentence * 60)]
        self.assertTrue(all(len(chunk) <= 500 for chunk in chunks))
        self.assertTrue(all(left[-50:] == right[:50] for left, right in zip(chunks, chunks[1:])))
        self.assertTrue(all(chunk.endswith("。") for chunk in chunks[:-1]))

    def test_unbroken_text_falls_back_to_hard_cut(self) -> None:
        chunks = [text for _, text in _chunk_sections("甲" * 1100)]
        self.assertEqual([len(chunk) for chunk in chunks], [500, 500, 200])
        self.assertTrue(all(left[-50:] == right[:50] for left, right in zip(chunks, chunks[1:])))

    def test_comma_is_used_when_no_paragraph_or_sentence_boundary_exists(self) -> None:
        chunks = [text for _, text in _chunk_sections("甲" * 320 + "，" + "乙" * 400)]
        self.assertEqual(len(chunks[0]), 321)
        self.assertTrue(all(len(chunk) <= 500 for chunk in chunks))

    def test_table_rows_are_preferred_to_hard_cut(self) -> None:
        row = "项目|数值|说明\n"
        chunks = [text for _, text in _chunk_sections(row * 70)]
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

    def test_pdf_cleans_repeated_margins_and_joins_cross_page_sentence(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "跨页制度.pdf"
            with pymupdf.open() as document:
                document.new_page(width=595, height=842)
                document.new_page(width=595, height=842)
                for number in (1, 2):
                    page = document.load_page(number - 1)
                    page.insert_text((50, 30), "INTERNAL USE ONLY", fontsize=9)
                    page.insert_text((280, 820), f"- {number} -", fontsize=9)
                document.load_page(0).insert_text((50, 120), "This policy applies to", fontsize=10)
                document.load_page(1).insert_text((50, 120), "all financial institutions.", fontsize=10)
                document.save(path)

            parsed = parse_document(path)

        text = "\n".join(chunk.text for chunk in parsed.chunks)
        self.assertEqual(parsed.page_count, 2)
        self.assertNotIn("INTERNAL USE ONLY", text)
        self.assertNotIn("- 1 -", text)
        self.assertIn("This policy applies to all financial institutions.", text)

    def test_pdf_chunks_locate_their_first_text_on_the_original_page(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "长续段.pdf"
            with pymupdf.open() as document:
                document.new_page(width=2500).insert_text((72, 300), "Start " + "A" * 250, fontsize=8)
                page = document.new_page(width=2500)
                for line in range(6):
                    page.insert_text((72, 300 + 12 * line), "B" * 185 + ("." if line == 5 else ""), fontsize=8)
                document.save(path)
            parsed = parse_document(path)

        self.assertEqual([chunk.page_number for chunk in parsed.chunks], [1, 2, 2])
        self.assertTrue(all("A" not in chunk.text for chunk in parsed.chunks[1:]))

    def test_pdf_does_not_join_across_an_unreadable_page(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "缺页.pdf"
            with pymupdf.open() as document:
                document.new_page().insert_text((72, 300), "This is a complete heading")
                document.new_page()
                document.new_page().insert_text((72, 300), "Another part of the document.")
                document.save(path)
            parsed = parse_document(path)

        self.assertEqual([chunk.page_number for chunk in parsed.chunks], [1, 3])
        self.assertTrue(any("第 2 页无可提取文字" in warning for warning in parsed.warnings))

    def test_attachment_after_continued_text_stops_article_inheritance(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "附件制度.pdf"
            with pymupdf.open() as document:
                document.new_page().insert_text((72, 300), "第五条 机构应当保存记录。", fontname="china-s")
                document.new_page().insert_text(
                    (72, 300), "机构应当定期报告。\n附件一\n其他主题内容。", fontname="china-s",
                )
                document.new_page().insert_text((72, 300), "本说明仅适用于境内银行。", fontname="china-s")
                document.save(path)
            parsed = parse_document(path)

        self.assertEqual([chunk.article_number for chunk in parsed.chunks], ["第五条", "第五条", None, None])

    def test_pdf_table_rows_are_parsed_once(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "表格制度.pdf"
            with pymupdf.open() as document:
                page = document.new_page(width=595, height=842)
                xs = [50, 200, 350, 500]
                ys = [100, 130, 160, 190]
                for y in ys:
                    page.draw_line((xs[0], y), (xs[-1], y), color=(0, 0, 0), width=1)
                for x in xs:
                    page.draw_line((x, ys[0]), (x, ys[-1]), color=(0, 0, 0), width=1)
                cells = [
                    ["Item", "Current", "Prior"],
                    ["Revenue", "100", "90"],
                    ["Profit", "20", "18"],
                ]
                for row, values in enumerate(cells):
                    for column, value in enumerate(values):
                        page.insert_text((xs[column] + 5, ys[row] + 20), value, fontsize=10)
                document.save(path)

            parsed = parse_document(path)

        text = "\n".join(chunk.text for chunk in parsed.chunks)
        self.assertIn("Item | Current | Prior", text)
        self.assertIn("Revenue | 100 | 90", text)
        self.assertEqual(text.count("Revenue"), 1)

    def test_pdf_table_keeps_prose_from_the_same_text_block(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "表格邻接正文.pdf"
            with pymupdf.open() as document:
                page = document.new_page()
                for x in (50, 200, 350):
                    page.draw_line((x, 100), (x, 140))
                for y in (100, 120, 140):
                    page.draw_line((50, y), (350, y))
                for x, y, text in (
                    (55, 115, "RowOne"), (205, 115, "100"),
                    (205, 135, "200"), (55, 135, "RowTwo"),
                    (55, 148, "Institution must use real evidence."),
                ):
                    page.insert_text((x, y), text, fontsize=9)
                document.save(path)
            parsed = parse_document(path)

        text = "\n".join(chunk.text for chunk in parsed.chunks)
        self.assertIn("RowOne | 100", text)
        self.assertIn("RowTwo | 200", text)
        self.assertTrue(text.endswith("Institution must use real evidence."))
        self.assertEqual(text.count("RowTwo"), 1)

    def test_article_number_continues_across_page_without_marker(self):
        chunks = _chunks_from_pages(
            [PageText("第五条 机构应当保存记录。", ((0, 1),)), PageText("机构应当定期报告。", ((0, 2),))],
        )
        self.assertEqual([chunk.article_number for chunk in chunks], ["第五条", "第五条"])
        self.assertEqual([chunk.page_number for chunk in chunks], [1, 2])

    def test_lettered_attachment_and_appendix_stop_article_inheritance(self):
        for heading in ("附件甲", "附件A", "附录B：术语"):
            with self.subTest(heading=heading):
                chunks = _chunks_from_pages([
                    PageText(f"第一条 正文。\n{heading}\n其他内容。", ((0, 1),)),
                    PageText("本说明仅适用于境内银行。", ((0, 2),)),
                ])
                self.assertEqual([chunk.article_number for chunk in chunks], ["第一条", None, None])

    def test_chapter_heading_stops_article_inheritance(self):
        chunks = _chunks_from_pages(
            [
                PageText("第五条 机构应当保存记录。", ((0, 1),)),
                PageText("第二章 报告要求", ((0, 2),)),
                PageText("机构应当定期报告。", ((0, 3),)),
            ],
        )
        self.assertEqual([chunk.article_number for chunk in chunks], ["第五条", None, None])

    def test_low_confidence_ocr_page_adds_review_warning(self):
        class LowConfidenceOCR:
            def recognize(self, image_path: Path) -> str:
                return "第一条 扫描页内容。"

            def recognize_result(self, image_path: Path) -> OCRResult:
                return OCRResult(
                    text="第一条 扫描页内容。",
                    lines=(OCRLine("第一条 扫描页内容。", 0.3, 0.34, 0.1, 0.42),),
                    mean_confidence=0.42,
                )

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "低置信度.pdf"
            writer = PdfWriter()
            writer.add_blank_page(width=612, height=792)
            with path.open("wb") as output:
                writer.write(output)
            parsed = parse_document(path, ocr=LowConfidenceOCR())

        self.assertTrue(any("置信度" in warning for warning in parsed.warnings))
