import os
import re
import json
import hashlib
from pathlib import Path
import pymupdf
pymupdf.TOOLS.mupdf_display_errors(False) 

BASE_DIR = Path(r"C:\Users\wy\Desktop\university\rag\finRAG")
RAW_TXT_DIR = BASE_DIR / "data" / "raw" / "txts"   
RAW_PDF_DIR = BASE_DIR / "data" / "raw" / "pdfs"   
PROCESSED_DIR = BASE_DIR / "data" / "processed"    
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

def clean_web_text(text: str) -> str:
    """专门用于清洗网页抓下来的 TXT，剔除导航栏等废话"""
    # 1. 找到正文的起点（通常在 "文章来源：" 或 "打印本页" 之后）
    # 如果找不到，就用原文本
    if "关闭窗口" in text:
        # 截取“关闭窗口”之后的内容（真正的正文）
        text = text.split("关闭窗口", 1)[-1]
    elif "文章来源：" in text:
        text = text.split("文章来源：", 1)[-1]
        
    # 2. 找到正文的终点（通常结尾有“打印本页”或“法律声明”）
    if "打印本页" in text:
        text = text.split("打印本页")[0]
    elif "法律声明" in text:
        text = text.split("法律声明")[0]
        
    # 3. 清理残留的换行和空格
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

def chunk_by_clause(text: str, metadata: dict, page_mapping: list = None) -> list:
    chunks = []
    
    # 核心过滤：如果文本里连一个“第X条”都找不到，说明不是制度文件，直接丢弃！
    if not re.search(r'第[一二三四五六七八九十百千万]+条', text):
        return []
        
    match = re.search(r'第[一二三四五六七八九十百千万]+条', text)
    body_text = text[match.start():] 
        
    clause_pattern = r'(?=第[一二三四五六七八九十百千万]+条)'
    clauses = re.split(clause_pattern, body_text)
    
    current_chapter = "总则/前言"
    current_pos = 0
    
    for idx, clause in enumerate(clauses):
        clause = clause.strip()
        if not clause or len(clause) < 10: continue # 过滤掉太短的碎片
            
        clause_start_pos = body_text.find(clause, current_pos)
        current_pos = clause_start_pos + len(clause)
        
        target_page = None
        if page_mapping:
            for pm in page_mapping:
                if pm["start"] <= clause_start_pos <= pm["end"]:
                    target_page = pm["page"]
                    break

        chapter_match = re.search(r'(第[一二三四五六七八九十]+章\s*[^\n]*)', clause)
        if chapter_match:
            current_chapter = chapter_match.group(1).strip()
            
        clause_num = ""
        num_match = re.match(r'(第[一二三四五六七八九十百千万]+条)', clause)
        if num_match:
            clause_num = num_match.group(1)
            
        chunk = {
            "chunk_id": f"{metadata['file_hash']}-{idx:03d}",
            "text": clause,
            "metadata": {
                "doc_title": metadata["title"],
                "file_type": metadata["file_type"],
                "page": target_page,
                "chapter": current_chapter,
                "clause_num": clause_num,
            }
        }
        chunks.append(chunk)
    return chunks

def process_file(file_path: Path, file_type: str) -> list:
    file_hash = hashlib.md5(file_path.name.encode('utf-8')).hexdigest()[:8]
    
    if file_type == "txt":
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            content = clean_web_text(content) # 清洗网页废话
        except Exception:
            return []
        title = file_path.stem
        page_mapping = None
        
    elif file_type == "pdf":
        try:
            content, page_mapping = extract_text_from_pdf(file_path)
        except Exception:
            return []
        if not content.strip(): return []
        title = file_path.stem
    
    metadata = {"title": title, "file_hash": file_hash, "file_type": file_type}
    return chunk_by_clause(content, metadata, page_mapping)

def main():
    all_chunks = []
    discarded_count = 0
    
    if RAW_TXT_DIR.exists():
        txt_files = list(RAW_TXT_DIR.glob("*.txt"))
        print(f"📂 发现 {len(txt_files)} 个 TXT 文件，开始处理...")
        for file_path in txt_files:
            chunks = process_file(file_path, "txt")
            if not chunks:
                discarded_count += 1
            all_chunks.extend(chunks)

    if RAW_PDF_DIR.exists():
        pdf_files = list(RAW_PDF_DIR.glob("*.pdf"))
        print(f"📂 发现 {len(pdf_files)} 个 PDF 文件，开始处理...")
        for file_path in pdf_files:
            chunks = process_file(file_path, "pdf")
            if not chunks:
                discarded_count += 1
            all_chunks.extend(chunks)

    output_file = PROCESSED_DIR / "chunks.jsonl"
    with open(output_file, 'w', encoding='utf-8') as f:
        for chunk in all_chunks:
            f.write(json.dumps(chunk, ensure_ascii=False) + "\n")
            
    print(f"\n🎉 处理完成！共生成 {len(all_chunks)} 个有效制度知识块 (Chunks)。")
    print(f"🗑️ 过滤并丢弃了 {discarded_count} 个非制度/新闻/损坏文件。")
    print(f"📄 输出文件: {output_file}")

if __name__ == "__main__":
    main()