# 离线导入与 OCR 联调

## 运行入口

在仓库根目录准备 `data/raw/txts/`、`data/raw/pdfs/` 和 `data/raw/images/`，分别放入已获准使用的 TXT、PDF 和 JPG/PNG 文件。运行：

```bash
docker compose run --rm --no-deps --build backend python process_docs.py
```

原始目录只读挂载到 `/app/data/raw`，输出目录挂载到 `/app/data/processed`。结果为宿主机的 `data/processed/chunks.jsonl`。导入在一次性容器中运行，不影响在线 API 进程。图片单文件排查入口：

```bash
docker compose run --rm --no-deps backend python test_ocr.py "/app/data/raw/images/文件名.png"
```

## 自动化验证

在安装 `backend/requirements-dev.txt` 的 Python 3.12 环境中运行：

```bash
cd backend
python -m pytest tests/integration/test_document_import.py
```

测试使用临时 TXT、真实 PyMuPDF 生成的两页 PDF 和 OCR Stub，覆盖文本层优先、无文本页触发 OCR、临时图片清理、JSONL 输出和手动 OCR 命令的路径参数。测试不加载 PaddleOCR 模型、不下载模型权重，也不依赖 MySQL 或 Milvus。CI 除运行 pytest 外，还在构建的后端容器中执行 `process_docs.py --help`，验证脚本及依赖已进入镜像。

## 当前限制

此脚本只完成基础清洗、OCR 文字提取和 JSONL 切分。OCR 文本框、置信度、Tesseract 备用实现、增量导入、Embedding 与 Milvus 写入尚未接入。扫描页首次运行可能需要下载 PaddleOCR 模型；结果应在入库前人工检查来源和条文质量。每次运行会覆盖现有 `chunks.jsonl`。

收到的既有 JSONL 样例共 100 条，涉及 4 个标题；其中 15 条的标题属于资讯或制度解读，不能直接作为制度原文入库。100 条的 `source_url` 均为空、`page_number` 均为 `null`。本 PR 的 100 道评测题引用 21 个文档标题，与该样例中的 4 个标题没有精确匹配，暂时不能用这批 Chunk 验证评测题。该文件是历史切分结果而非原始文档，因此只用于本次质量核查，不作为解析输入，也不提交原文件。正式入库前仍需取得原始文件并核对来源与页码。
