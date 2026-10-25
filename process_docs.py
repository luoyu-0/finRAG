import os
import re
import json
import hashlib
from pathlib import Path
import pymupdf

# 屏蔽 PyMuPDF 底层的解析警告（针对损坏的 PDF 结构）
pymupdf.TOOLS.mupdf_display_errors(False) 

# ================= 路径配置 =================
BASE_DIR = Path(r"C:\Users\wy\Desktop\university\rag\finRAG")
RAW_TXT_DIR = BASE_DIR / "data" / "raw" / "txts"   
RAW_PDF_DIR = BASE_DIR / "data" / "raw" / "pdfs"   
PROCESSED_DIR = BASE_DIR / "data" / "processed"    
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

# ================= 核心函数 =================

def clean_web_text(text: str) -> str:
    """专门用于清洗网页抓下来的 TXT，剔除导航栏等废话"""
    # 1. 找到正文的起点（通常在 "关闭窗口" 或 "文章来源：" 之后）
    if "关闭窗口" in text:
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
    """从 PDF 提取文本，并保留页码映射"""
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
            # 过滤纯数字页码
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
    """按“第X条”切分，并严格对齐开发 A 的 CitationResponse 字段"""
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
        
        # 计算页码溯源
        target_page = None
        if page_mapping:
            for pm in page_mapping:
                if pm["start"] <= clause_start_pos <= pm["end"]:
                    target_page = pm["page"]
                    break

        # 尝试提取章节名
        chapter_match = re.search(r'(第[一二三四五六七八九十]+章\s*[^\n]*)', clause)
        if chapter_match:
            current_chapter = chapter_match.group(1).strip()
            
        # 尝试提取条款号
        article_num = ""
        num_match = re.match(r'(第[一二三四五六七八九十百千万]+条)', clause)
        if num_match:
            article_num = num_match.group(1)
            
        # 组装 Chunk（完美对齐开发 A 的字段要求）
        chunk = {
            "chunk_id": f"{metadata['file_hash']}-{idx:03d}",
            "text": clause,
            "metadata": {
                "document_id": metadata["file_hash"],     # 用文件哈希作文档 ID
                "version_id": "v1.0",                     # 默认版本 1.0
                "title": metadata["title"],               # 对应 title
                "page_number": target_page,               # 对应 page_number
                "article_number": article_num,            # 对应 article_number
                "source_url": metadata.get("source_url", ""),
                "chapter": current_chapter,               # 额外保留章节信息（方便检索）
            }
        }
        chunks.append(chunk)
    return chunks

def process_file(file_path: Path, file_type: str) -> list:
    """统一处理入口"""
    file_hash = hashlib.md5(file_path.name.encode('utf-8')).hexdigest()[:8]
    source_url = ""
    
    if file_type == "txt":
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            # 提取网页里的来源URL（如果你之前的爬虫存了的话）
            url_match = re.search(r'来源URL:\s*(http[^\s]+)', content)
            if url_match: source_url = url_match.group(1)
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
    
    metadata = {
        "title": title, 
        "file_hash": file_hash, 
        "file_type": file_type,
        "source_url": source_url
    }
    return chunk_by_clause(content, metadata, page_mapping)

def main():
    all_chunks = []
    discarded_count = 0
    
    # 1. 处理 TXT
    if RAW_TXT_DIR.exists():
        txt_files = list(RAW_TXT_DIR.glob("*.txt"))
        print(f"📂 发现 {len(txt_files)} 个 TXT 文件，开始处理...")
        for file_path in txt_files:
            chunks = process_file(file_path, "txt")
            if not chunks:
                discarded_count += 1
            all_chunks.extend(chunks)

    # 2. 处理 PDF
    if RAW_PDF_DIR.exists():
        pdf_files = list(RAW_PDF_DIR.glob("*.pdf"))
        print(f"📂 发现 {len(pdf_files)} 个 PDF 文件，开始处理...")
        for file_path in pdf_files:
            chunks = process_file(file_path, "pdf")
            if not chunks:
                discarded_count += 1
            all_chunks.extend(chunks)

    # 3. 输出结果
    output_file = PROCESSED_DIR / "chunks.jsonl"
    with open(output_file, 'w', encoding='utf-8') as f:
        for chunk in all_chunks:
            f.write(json.dumps(chunk, ensure_ascii=False) + "\n")
            
    print(f"\n🎉 处理完成！共生成 {len(all_chunks)} 个有效制度知识块 (Chunks)。")
    print(f"🗑️ 过滤并丢弃了 {discarded_count} 个非制度/新闻/损坏文件。")
    print(f"📄 输出文件: {output_file}")

if __name__ == "__main__":
    main()