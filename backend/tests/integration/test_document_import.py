"""使用临时文件验证离线解析流程，OCR 模型由测试替身代替。"""

import importlib.util
import json
import sys
import types
from pathlib import Path

import pymupdf
import pytest


ROOT_DIR = Path(__file__).resolve().parents[3]


@pytest.fixture
def processor(monkeypatch):
    paddleocr = types.ModuleType("paddleocr")

    class UnexpectedOCR:
        def __init__(self, **_kwargs):
            raise AssertionError("测试不应下载或初始化 OCR 模型")

    paddleocr.PaddleOCR = UnexpectedOCR
    monkeypatch.setitem(sys.modules, "paddleocr", paddleocr)

    spec = importlib.util.spec_from_file_location("process_docs", ROOT_DIR / "process_docs.py")
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, "process_docs", module)
    spec.loader.exec_module(module)
    return module


def test_txt_import_writes_jsonl(processor, monkeypatch, tmp_path):
    txt_dir = tmp_path / "txts"
    txt_dir.mkdir()
    (txt_dir / "制度.txt").write_text(
        "来源URL: https://example.org/policy\n第一条 本办法适用于金融机构。",
        encoding="utf-8",
    )
    out_dir = tmp_path / "processed"
    monkeypatch.setattr(
        sys,
        "argv",
        ["process_docs.py", "--txt_dir", str(txt_dir), "--pdf_dir", str(tmp_path / "pdfs"),
         "--img_dir", str(tmp_path / "images"), "--out_dir", str(out_dir)],
    )

    processor.main()

    chunks = [json.loads(line) for line in (out_dir / "chunks.jsonl").read_text(encoding="utf-8").splitlines()]
    article = next(chunk for chunk in chunks if chunk["metadata"]["article_number"] == "第一条")
    assert "本办法适用于金融机构" in article["text"]
    assert article["metadata"]["source_url"] == "https://example.org/policy"


def test_pdf_uses_text_layer_and_ocr_only_for_blank_page(processor, monkeypatch, tmp_path):
    pdf_path = tmp_path / "mixed.pdf"
    with pymupdf.open() as pdf:
        pdf.new_page().insert_text((72, 72), "Readable policy text")
        pdf.new_page()
        pdf.save(pdf_path)

    temporary_images = []

    class StubOCR:
        def predict(self, image_path):
            path = Path(image_path)
            assert path.is_file()
            temporary_images.append(path)
            return [{"rec_texts": ["第一条 扫描页内容"]}]

    monkeypatch.setattr(processor, "get_ocr", lambda: StubOCR())
    text, pages = processor.extract_text_from_pdf(pdf_path)

    assert "Readable policy text" in text
    assert "第一条 扫描页内容" in text
    assert [page["page"] for page in pages] == [1, 2]
    assert len(temporary_images) == 1
    assert not temporary_images[0].exists()


def test_pdf_ocr_failure_cleans_temporary_image(processor, monkeypatch, tmp_path):
    pdf_path = tmp_path / "scanned.pdf"
    with pymupdf.open() as pdf:
        pdf.new_page()
        pdf.save(pdf_path)

    temporary_images = []

    class FailingOCR:
        def predict(self, image_path):
            temporary_images.append(Path(image_path))
            raise RuntimeError("模拟 OCR 失败")

    monkeypatch.setattr(processor, "get_ocr", lambda: FailingOCR())
    with pytest.raises(RuntimeError, match="模拟 OCR 失败"):
        processor.extract_text_from_pdf(pdf_path)

    assert len(temporary_images) == 1
    assert not temporary_images[0].exists()


def test_image_cli_uses_supplied_path(processor, monkeypatch, tmp_path, capsys):
    image_path = tmp_path / "sample.png"
    image_path.write_bytes(b"test image")

    class StubOCR:
        def predict(self, path):
            assert Path(path) == image_path
            return [{"rec_texts": ["第一条 图片内容"]}]

    monkeypatch.setattr(processor, "get_ocr", lambda: StubOCR())
    spec = importlib.util.spec_from_file_location("manual_ocr", ROOT_DIR / "test_ocr.py")
    manual_ocr = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manual_ocr)

    manual_ocr.main([str(image_path)])
    assert "第一条 图片内容" in capsys.readouterr().out
    with pytest.raises(SystemExit) as error:
        manual_ocr.main([str(tmp_path / "missing.png")])
    assert error.value.code == 2
