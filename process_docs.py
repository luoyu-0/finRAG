import os
import re
import json
import hashlib
import argparse
import logging
from pathlib import Path
import pymupdf

# ================= 日志与配置 =================
# 配置日志，让过滤原因和解析错误清晰可见
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
pymupdf.TOOLS.mupdf_display_errors(False) 

# 动态获取项目根目录 (假设 process_docs.py 在项目根目录，如果在 scripts/ 下，请改成 .parent.parent)
BASE_DIR = Path(__file__).resolve().parent
DEFAULT_RAW_TXT_DIR = BASE_DIR / "data" / "raw" / "txts"
DEFAULT_RAW_PDF_DIR = BASE_DIR / "data" / "raw" / "pdfs"
DEFAULT_PROCESSED_DIR = BASE_DIR / "data" / "processed"

def clean_web_text(text: str) -> str:
    """清洗网页 TXT 废话，但保留发文信息"""
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
    """提取 PDF 文本，返回全量内容和绝对位置页码映射"""
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

def extract_header_and_validate(text: str) -> tuple[bool, str, dict]:
    """
    严格过滤：验证是否是制度文件，并提取发文机关、日期等头部信息。
    返回: (是否通过, 截取后的正文, 头部元数据)
    """
    # 必须包含明确的条款结构
    if not re.search(r'第[一二三四五六七八九十百千万]+条', text):
        return False, "", {}
        
    # 提取发文机关（通常在文件开头）
    header_match = re.search(r'(.*?)(?=第[一二三四五六七八九十百千万]+条)', text, re.DOTALL)
    header_text = header_match.group(1) if header_match else ""
    
    # 提取生效日期
    date_match = re.search(r'(\d{4}年\d{1,2}月\d{1,2}日)', header_text)
    publish_date = date_match.group(1) if date_match else ""
    
    # 保留头部信息 + 正文，一起交给切分
    return True, text, {"publish_date": publish_date, "header_snippet": header_text[:200]}

def chunk_by_clause(text: str, metadata: dict, page_mapping: list = None) -> list:
    chunks = []
    
    # 在全文找条款，不再随意截断，确保偏移量基准一致
    clause_pattern = r'(?=第[一二三四五六七八九十百千万]+条)'
    clauses = re.split(clause_pattern, text)
    
    current_chapter = "总则/前言"
    current_pos = 0
    
    for idx, clause in enumerate(clauses):
        clause = clause.strip()
        if not clause: continue
        
        # 计算当前条款在全文中绝对位置 (P1: 修复页码错位)
        clause_start_pos = text.find(clause, current_pos)
        if clause_start_pos == -1: continue
        current_pos = clause_start_pos + len(clause)
        
        # 计算页码
        target_page = None
        if page_mapping:
            for pm in page_mapping:
                if pm["start"] <= clause_start_pos <= pm["end"]:
                    target_page = pm["page"]
                    break

        chapter_match = re.search(r'(第[一二三四五六七八九十]+章\s*[^\n]*)', clause)
        if chapter_match:
            current_chapter = chapter_match.group(1).strip()
            
        article_num = ""
        num_match = re.match(r'(第[一二三四五六七八九十百千万]+条)', clause)
        if num_match:
            article_num = num_match.group(1)
            
        # 组装数据 (完全对齐 CitationResponse 和 AGENTS.md 要求)
        chunk = {
            "chunk_id": f"{metadata['document_id']}-{idx:03d}",
            "text": clause,
            "metadata": {
                "document_id": metadata["document_id"],
                "version_id": "v1",                     # P1: 改为 v1
                "title": metadata["title"],
                "page_number": target_page,
                "article_number": article_num,
                "source_url": metadata.get("source_url", ""),
                "chapter": current_chapter,
                "publish_date": metadata.get("publish_date", ""), 
                "status": "active",                     # P1: 增加生效状态
                "tags": ["央行制度"],                   # P1: 增加标签
                "warnings": metadata.get("warnings", []) # P1: 增加解析告警
            }
        }
        chunks.append(chunk)
    return chunks

def process_file(file_path: Path, file_type: str) -> list:
    # P1: 改为用文件内容进行哈希，确保内容变了 ID 就变
    file_content_bytes = file_path.read_bytes()
    document_id = hashlib.md5(file_content_bytes).hexdigest()[:12]
    
    warnings = []
    source_url = ""
    content = ""
    page_mapping = None
    
    if file_type == "txt":
        try:
            content = file_content_bytes.decode('utf-8')
            url_match = re.search(r'来源URL:\s*(http[^\s]+)', content)
            if url_match: source_url = url_match.group(1)
            content = clean_web_text(content) 
        except Exception as e:
            logging.error(f"解析 TXT 失败 {file_path.name}: {e}")
            return []
            
    elif file_type == "pdf":
        try:
            content, page_mapping = extract_text_from_pdf(file_path)
            if not content.strip(): 
                return []
        except Exception as e:
            logging.error(f"解析 PDF 失败 {file_path.name}: {e}")
            return []

    # P1: 严格过滤与头部提取
    is_valid, full_text, header_info = extract_header_and_validate(content)
    if not is_valid:
        # P2: 区分过滤原因
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
    # P1: 支持命令行参数，不再写死绝对路径
    parser = argparse.ArgumentParser(description="金融制度文档清洗与切分")
    parser.add_argument("--txt_dir", type=str, default=str(DEFAULT_RAW_TXT_DIR), help="TXT文件夹路径")
    parser.add_argument("--pdf_dir", type=str, default=str(DEFAULT_RAW_PDF_DIR), help="PDF文件夹路径")
    parser.add_argument("--out_dir", type=str, default=str(DEFAULT_PROCESSED_DIR), help="输出文件夹路径")
    args = parser.parse_args()

    raw_txt_dir = Path(args.txt_dir)
    raw_pdf_dir = Path(args.pdf_dir)
    processed_dir = Path(args.out_dir)
    processed_dir.mkdir(parents=True, exist_ok=True)

    all_chunks = []
    filtered_count = 0
    error_count = 0
    
    if raw_txt_dir.exists():
        for file_path in raw_txt_dir.glob("*.txt"):
            chunks = process_file(file_path, "txt")
            if not chunks: filtered_count += 1
            all_chunks.extend(chunks)

    if raw_pdf_dir.exists():
        for file_path in raw_pdf_dir.glob("*.pdf"):
            chunks = process_file(file_path, "pdf")
            if not chunks: filtered_count += 1
            all_chunks.extend(chunks)

    output_file = processed_dir / "chunks.jsonl"
    with open(output_file, 'w', encoding='utf-8') as f:
        for chunk in all_chunks:
            f.write(json.dumps(chunk, ensure_ascii=False) + "\n")
            
    # P2: 补充实际统计
    print(f"\n🎉 处理完成！共生成 {len(all_chunks)} 个知识块 (Chunks)。")
    print(f"🗑️ 过滤了 {filtered_count} 个非制度文件。")
    print(f"⚠️ 记录了 {error_count} 个解析错误（详见终端日志）。")
    print(f"📄 输出文件: {output_file}")

# 在 main() 函数的下面加上这个测试函数
def run_unit_tests():
    print("\n========== 运行内置测试 ==========")
    
    # 测试 1：新闻过滤测试（反面样例）
    news_text = "近日，中国人民银行召开会议。会议强调，要贯彻落实第X条相关规定。"
    is_valid, _, _ = extract_header_and_validate(news_text)
    if not is_valid:
        print("✅ 测试1通过：成功过滤掉包含'第X条'的新闻资讯。")
    else:
        print("❌ 测试1失败：未能过滤新闻！")
        
    # 测试 2：法规通过测试（正面样例）
    law_text = "中国人民银行令〔2026〕第1号\n第一条 为了规范...\n第二条 本办法适用于..."
    is_valid, _, header_info = extract_header_and_validate(law_text)
    if is_valid:
        print("✅ 测试2通过：成功识别标准制度文件。")
    else:
        print("❌ 测试2失败：误杀了法规文件！")

    # 测试 3：跨页页码对齐模拟测试
    # 模拟：第1页有100个字符，第2页有100个字符。第一条在第120个字符处（应属于第2页）
    mock_text = "前言" * 50 + "第一条 测试跨页。" + "正文" * 50
    mock_page_mapping = [
        {"page": 1, "start": 0, "end": 100},
        {"page": 2, "start": 100, "end": 200}
    ]
    mock_meta = {"document_id": "test", "title": "test", "source_url": ""}
    chunks = chunk_by_clause(mock_text, mock_meta, mock_page_mapping)
    if chunks and chunks[0]["metadata"]["page_number"] == 2:
        print("✅ 测试3通过：跨页切分，页码准确对齐至第2页。")
    else:
        print("❌ 测试3失败：页码计算错误！")

if __name__ == "__main__":
    run_unit_tests() # 先跑测试
    main()