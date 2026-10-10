"""问答 API Schema 单元测试。"""

import unittest
from datetime import datetime

from pydantic import ValidationError

from app.schemas.qa import QuestionRequest


class QuestionRequestTests(unittest.TestCase):
    def test_normalizes_question(self) -> None:
        request = QuestionRequest(question="  制度依据是什么？  ")

        self.assertEqual(request.question, "制度依据是什么？")
        self.assertEqual(request.top_k, 8)

    def test_rejects_naive_effective_time(self) -> None:
        with self.assertRaises(ValidationError):
            QuestionRequest(
                question="测试问题",
                effective_at=datetime(2026, 10, 10),
            )


if __name__ == "__main__":
    unittest.main()
