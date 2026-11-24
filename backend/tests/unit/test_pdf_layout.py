"""版式清洗、跨页拼接、表格转换与数据范围过滤的纯函数测试。"""

import unittest

from app.services.documents.filters import exclusion_reason, is_ignored_path
from app.services.documents.layout import (
    PageText,
    TextLine,
    is_noise_line,
    is_page_number,
    join_lines,
    line_inside_table,
    margin_noise,
    merge_across_pages,
    paragraphs_from_blocks,
    paragraphs_from_lines,
    should_join_paragraph,
    table_rows_to_text,
)


class PageNumberTests(unittest.TestCase):
    def test_common_page_number_styles(self):
        for text in ("1", "- 1 -", "第 2 页", "3/10", "Page 4 of 9"):
            self.assertTrue(is_page_number(text), text)

    def test_body_numbers_are_not_page_numbers(self):
        for text in ("第一条", "1.", "100 亿元"):
            self.assertFalse(is_page_number(text), text)


class MarginNoiseTests(unittest.TestCase):
    def test_repeated_margin_is_removed_but_body_copy_is_kept(self):
        pages = [
            [TextLine("内部资料", 0.02, 0.04), TextLine("第一条 正文", 0.40, 0.43)],
            [TextLine("内部资料", 0.02, 0.04), TextLine("内部资料", 0.50, 0.53)],
            [TextLine("内部资料", 0.02, 0.04), TextLine("- 3 -", 0.96, 0.98)],
        ]
        noise = margin_noise(pages)
        self.assertIn("内部资料", noise)
        self.assertTrue(is_noise_line(pages[0][0], noise))
        self.assertFalse(is_noise_line(pages[1][1], noise))
        self.assertTrue(is_noise_line(pages[2][1], noise))

    def test_single_page_has_no_repeated_margin(self):
        self.assertEqual(margin_noise([[TextLine("标题", 0.02, 0.04)]]), set())


class ParagraphTests(unittest.TestCase):
    def test_join_lines_handles_chinese_english_and_hyphen(self):
        self.assertEqual(join_lines(["这是跨", "页段落"]), "这是跨页段落")
        self.assertEqual(join_lines(["policy", "applies"]), "policy applies")
        self.assertEqual(join_lines(["finan-", "cial"]), "financial")

    def test_should_join_only_mid_sentence_continuations(self):
        self.assertTrue(should_join_paragraph("本办法适用于所有银行", "及其分支机构。"))
        self.assertFalse(should_join_paragraph("本办法适用于所有银行。", "第二条 另行规定。"))
        self.assertFalse(should_join_paragraph("本办法适用于所有银行", "第二条 另行规定。"))
        self.assertFalse(should_join_paragraph("第二章 总则", "第一条 为规范管理。"))
        self.assertFalse(should_join_paragraph("包括：", "（一）存款。"))
        self.assertFalse(should_join_paragraph("中国人民银行2024年度部门决算", "目录"))
        self.assertFalse(should_join_paragraph("项目 | 本期 | 上期", "下一年度数据。"))

    def test_merge_across_pages_preserves_source_offsets(self):
        merged = merge_across_pages([
            (1, ["第一段完整。", "这是跨页段落的前半句"]),
            (2, ["后半句。", "第二条 新条文。"]),
        ])
        prefix = "第一段完整。\n\n这是跨页段落的前半句"
        self.assertEqual(merged, [
            PageText(prefix + "后半句。", ((0, 1), (len(prefix), 2))),
            PageText("第二条 新条文。", ((0, 2),)),
        ])

    def test_page_boundary_accounts_for_dehyphenation_and_third_page(self):
        merged = merge_across_pages([
            (1, ["The regula-"]),
            (2, ["tion applies to"]),
            (3, ["all banks."]),
        ])
        self.assertEqual(merged, [
            PageText("The regulation applies to all banks.", ((0, 1), (len("The regula"), 2), (len("The regulation applies to "), 3))),
        ])

    def test_ocr_lines_are_grouped_and_noise_removed(self):
        lines = [
            TextLine("扫描页页眉", 0.01, 0.03),
            TextLine("第一条 机构应当", 0.30, 0.33),
            TextLine("保存业务记录。", 0.335, 0.365),
            TextLine("第二条 机构应当", 0.60, 0.63),
            TextLine("定期报告。", 0.635, 0.665),
        ]
        paragraphs = paragraphs_from_lines(lines, {"扫描页页眉"})
        self.assertEqual(paragraphs, ["第一条 机构应当保存业务记录。", "第二条 机构应当定期报告。"])

    def test_blocks_skip_noise_lines(self):
        blocks = [[TextLine("页眉", 0.01, 0.03), TextLine("正文第一行", 0.30, 0.33)]]
        self.assertEqual(paragraphs_from_blocks(blocks, {"页眉"}), ["正文第一行"])


class TableTests(unittest.TestCase):
    def test_table_rows_use_pipe_and_flatten_multiline_cells(self):
        rows = [["项目", "本期\n金额", "上期"], ["收入", "100", None]]
        self.assertEqual(table_rows_to_text(rows), "项目 | 本期 金额 | 上期\n收入 | 100")

    def test_all_empty_columns_are_dropped(self):
        rows = [["Item", "", "Current", "", "Prior"], ["Revenue", "", "100", "", "90"]]
        self.assertEqual(table_rows_to_text(rows), "Item | Current | Prior\nRevenue | 100 | 90")

    def test_only_lines_centered_inside_the_table_are_removed(self):
        table = [(100.0, 100.0, 500.0, 300.0)]
        self.assertTrue(line_inside_table((120.0, 120.0, 200.0, 160.0), table))
        self.assertFalse(line_inside_table((120.0, 500.0, 200.0, 540.0), table))


class ExclusionTests(unittest.TestCase):
    def test_financial_statements_are_excluded(self):
        for name in (
            "(公告信息)_中国人民银行2024年度部门决算.pdf",
            "(公告信息)_中国人民银行2026年预算.pdf",
            "(银行会计)_中国人民银行2013年预算.pdf",
            "某银行2025年财务报表.pdf",
            "审计报告.pdf",
        ):
            self.assertIsNotNone(exclusion_reason(name), name)

    def test_policy_documents_are_not_excluded(self):
        for name in (
            "(法律法规)_中华人民共和国预算法.txt",
            "企业会计准则第30号——财务报表列报.pdf",
            "中国注册会计师审计准则第1501号——对财务报表形成审计意见和出具审计报告.pdf",
            "关于编报2026年度部门预算的通知.pdf",
            "(宏观审慎)_2025年人民币国际化报告.pdf",
            "(金融稳定)_中国金融稳定报告（2022）.pdf",
            "(支付体系)_2025年第三季度支付体系运行总体情况.pdf",
        ):
            self.assertIsNone(exclusion_reason(name), name)

    def test_quarantine_directories_are_ignored(self):
        self.assertTrue(is_ignored_path("_excluded/财务报表/a.pdf"))
        self.assertTrue(is_ignored_path("pdfs/excluded/a.pdf"))
        self.assertFalse(is_ignored_path("pdfs/制度/a.pdf"))


if __name__ == "__main__":
    unittest.main()
