import os
import re
import json
import hashlib
import argparse
import logging
from pathlib import Path
import pymupdf
from paddleocr import PaddleOCR

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
pymupdf.TOOLS.mupdf_display_errors(False) 

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_RAW_TXT_DIR = BASE_DIR / "data" / "raw" / "txts"
DEFAULT_RAW_PDF_DIR = BASE_DIR / "data" / "raw" / "pdfs"
DEFAULT_RAW_IMG_DIR = BASE_DIR / "data" / "raw" / "images"
DEFAULT_PROCESSED_DIR = BASE_DIR / "data" / "processed"

ocr_engine = None
def get_ocr():
    global ocr_engine
    if ocr_engine is None:
        logging.info("⏳ 正在加载 PaddleOCR 模型...")
        # 关键：关闭 mkldnn，使用新版参数
        ocr_engine = PaddleOCR(lang="ch", use_textline_orientation=True, enable_mkldnn=False)
    return ocr_engine

def clean_web_text(text: str) -> str:
    if "关闭窗口" in text:
        text = text.split("关闭窗口", 1)[-1]
    elif "文章来源：" in text:
        text = text.split("文章来源：", 1)[-1]
    if "打印本页" in text:
        text = text.split("打印本页")[0]
    elif "法律声明" in text:
        text = text.split("法律声明")[0]
    text = text.replace('\u3000', ' ')
    text = re.sub(r'(?<!\n)\n(?!\n)', '', text)
    return text.strip()

def extract_text_from_pdf(pdf_path: Path):
    doc = pymupdf.open(pdf_path)
    full_text = ""
    page_mapping = []
    current_length = 0
    
    for page_num in range(len(doc)):
        page = doc.load_page(page_num)
        blocks = page.get_text("blocks")
        page_text = ""
        for block in blocks:
            block_text = block[4].strip()
            if block_text and not re.match(r'^\d+$', block_text): 
                page_text += block_text + "\n"
        
        if not page_text.strip():
            logging.info(f"  [OCR触发] PDF {pdf_path.name} 第 {page_num+1} 页无文本层，正在识别...")
            pix = page.get_pixmap(dpi=150)
            img_path = BASE_DIR / f"temp_{pdf_path.stem}_{page_num}.png"
            pix.save(img_path)
            
            # 新版 API 调用
            result = get_ocr().predict(str(img_path))
            if result:
                for res in result:
                    for text in res.get('rec_texts', []):
                        page_text += text + "\n"
            os.remove(img_path)
            
        if not page_text.strip(): continue
            
        page_mapping.append({
            "page": page_num + 1,
            "start": current_length,
            "end": current_length + len(page_text)
        })
        full_text += page_text + "\n"
        current_length = len(full_text)
    doc.close()
    return full_text, page_mapping

def extract_text_from_image(img_path: Path):
    logging.info(f"  [OCR识别] 图片: {img_path.name}")
    result = get_ocr().predict(str(img_path))
    full_text = ""
    if result:
        for res in result:
            for text in res.get('rec_texts', []):
                full_text += text + "\n"
    return full_text

def extract_header_and_validate(text: str) -> tuple[bool, str, dict]:
    if not re.search(r'第[一二三四五六七八九十百千万]+条', text):
        return False, "", {}
    header_match = re.search(r'(.*?)(?=第[一二三四五六七八九十百千万]+条)', text, re.DOTALL)
    header_text = header_match.group(1) if header_match else ""
    date_match = re.search(r'(\d{4}年\d{1,2}月\d{1,2}日)', header_text)
    publish_date = date_match.group(1) if date_match else ""
    return True, text, {"publish_date": publish_date}

def chunk_by_clause(text: str, metadata: dict, page_mapping: list = None) -> list:
    chunks = []
    clause_pattern = r'(?=第[一二三四五六七八九十百千万]+条)'
    clauses = re.split(clause_pattern, text)
    current_chapter = "总则/前言"
    current_pos = 0
    
    for idx, clause in enumerate(clauses):
        clause = clause.strip()
        if not clause: continue
        
        clause_start_pos = text.find(clause, current_pos)
        if clause_start_pos == -1: continue
        current_pos = clause_start_pos + len(clause)
        
        target_page = None
        if page_mapping:
            for pm in page_mapping:
                if pm["start"] <= clause_start_pos <= pm["end"]:
                    target_page = pm["page"]
                    break

        chapter_match = re.search(r'(第[一二三四五六七八九十]+章\s*[^\n]*)', clause)
        if chapter_match: current_chapter = chapter_match.group(1).strip()
            
        article_num = ""
        num_match = re.match(r'(第[一二三四五六七八九十百千万]+条)', clause)
        if num_match: article_num = num_match.group(1)
            
        chunk = {
            "chunk_id": f"{metadata['document_id']}-{idx:03d}",
            "text": clause,
            "metadata": {
                "document_id": metadata["document_id"],
                "version_id": "v1",
                "title": metadata["title"],
                "page_number": target_page,
                "article_number": article_num,
                "source_url": metadata.get("source_url", ""),
                "chapter": current_chapter,
                "publish_date": metadata.get("publish_date", ""), 
                "status": "active",
                "tags": ["央行制度"],
                "warnings": metadata.get("warnings", [])
            }
        }
        chunks.append(chunk)
    return chunks

def process_file(file_path: Path, file_type: str) -> list:
    file_content_bytes = file_path.read_bytes()
    document_id = hashlib.md5(file_content_bytes).hexdigest()[:12]
    warnings, content, page_mapping, source_url = [], "", None, ""
    
    try:
        if file_type == "txt":
            content = file_content_bytes.decode('utf-8')
            url_match = re.search(r'来源URL:\s*(http[^\s]+)', content)
            if url_match: source_url = url_match.group(1)
            content = clean_web_text(content) 
            
        elif file_type == "pdf":
            content, page_mapping = extract_text_from_pdf(file_path)
            
        elif file_type == "image":
            content = extract_text_from_image(file_path)
    except Exception as e:
        logging.error(f"解析失败 {file_path.name}: {e}")
        return []

    is_valid, full_text, header_info = extract_header_and_validate(content)
    if not is_valid:
        logging.warning(f"🚫 过滤非制度文件: {file_path.name}")
        return []
        
    metadata = {
        "title": file_path.stem, 
        "document_id": document_id, 
        "source_url": source_url,
        "publish_date": header_info.get("publish_date", ""),
        "warnings": warnings
    }
    return chunk_by_clause(full_text, metadata, page_mapping)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--txt_dir", type=str, default=str(DEFAULT_RAW_TXT_DIR))
    parser.add_argument("--pdf_dir", type=str, default=str(DEFAULT_RAW_PDF_DIR))
    parser.add_argument("--img_dir", type=str, default=str(DEFAULT_RAW_IMG_DIR))
    parser.add_argument("--out_dir", type=str, default=str(DEFAULT_PROCESSED_DIR))
    args = parser.parse_args()

    raw_txt_dir, raw_pdf_dir = Path(args.txt_dir), Path(args.pdf_dir)
    raw_img_dir, processed_dir = Path(args.img_dir), Path(args.out_dir)
    processed_dir.mkdir(parents=True, exist_ok=True)

    all_chunks = []
    filtered_count = 0
    
    if raw_txt_dir.exists():
        for f in raw_txt_dir.glob("*.txt"):
            chunks = process_file(f, "txt")
            if not chunks: filtered_count += 1
            all_chunks.extend(chunks)

    if raw_pdf_dir.exists():
        for f in raw_pdf_dir.glob("*.pdf"):
            chunks = process_file(f, "pdf")
            if not chunks: filtered_count += 1
            all_chunks.extend(chunks)
            
    if raw_img_dir.exists():
        img_files = list(raw_img_dir.glob("*.jpg")) + list(raw_img_dir.glob("*.png")) + list(raw_img_dir.glob("*.jpeg"))
        if img_files:
            print(f"📂 发现 {len(img_files)} 个图片，开始 OCR 处理...")
        for f in img_files:
            chunks = process_file(f, "image")
            if not chunks: filtered_count += 1
            all_chunks.extend(chunks)

    output_file = processed_dir / "chunks.jsonl"
    with open(output_file, 'w', encoding='utf-8') as f:
        for chunk in all_chunks:
            f.write(json.dumps(chunk, ensure_ascii=False) + "\n")
            
    print(f"\n🎉 处理完成！共生成 {len(all_chunks)} 个知识块 (Chunks)。")
    print(f"🗑️ 过滤了 {filtered_count} 个无效/新闻文件。")

if __name__ == "__main__":
    main()