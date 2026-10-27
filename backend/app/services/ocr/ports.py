"""OCR 识别端口。"""

from pathlib import Path
from typing import Protocol


class OCRProvider(Protocol):
    def recognize(self, image_path: Path) -> str: ...
