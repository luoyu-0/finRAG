"""问答评测报告的纯本地行为。"""

import json
from pathlib import Path

from app.workers.evaluate_qa import _plain_text, _write_report


def test_markdown_answer_is_normalized_for_comparison() -> None:
    assert _plain_text("### 结论\n\n**银行** 应当报告。") == "银行应当报告。"


def test_report_contains_case_and_summary(tmp_path: Path) -> None:
    target = tmp_path / "qa_evaluation.json"
    _write_report(target, [{
        "id": 1, "question": "谁负责？", "ground_truth": "银行负责。",
        "answer": "### 结论\n\n银行负责。", "similarity": 1.0,
        "source_hit": True, "clause_hit": True,
        "citations": [{"title": "示例制度", "article_number": "第一条"}],
    }])
    report = json.loads(target.read_text(encoding="utf-8"))
    assert report["summary"]["source_hit_rate"] == 1.0
    assert "银行负责。" in target.with_suffix(".md").read_text(encoding="utf-8")
