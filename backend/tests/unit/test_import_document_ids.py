"""同内容的不同文件必须使用互不冲突的分块 ID。"""

import unittest

from app.workers.import_documents import _chunk_ids


class ChunkIdTests(unittest.TestCase):
    def test_same_version_in_different_documents_has_distinct_ids(self) -> None:
        first = _chunk_ids("document-a", "same-version", 3)
        second = _chunk_ids("document-b", "same-version", 3)

        self.assertEqual(first, _chunk_ids("document-a", "same-version", 3))
        self.assertEqual(len(first), 3)
        self.assertTrue(set(first).isdisjoint(second))


if __name__ == "__main__":
    unittest.main()
