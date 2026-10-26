from paddleocr import PaddleOCR

print("⏳ 正在加载 OCR 引擎（模型已下载，这次会很快）...")
# 新版 API 语法：去掉了 use_angle_cls，改成 use_textline_orientation
ocr = PaddleOCR(lang="ch", use_textline_orientation=True,enable_mkldnn=False)

img_path = r"C:\Users\wy\Desktop\university\rag\finRAG\data\raw\images\屏幕截图 2026-10-26 223317.png"

print(f"🔍 正在识别: {img_path}")
# 新版 API 用 predict，不需要传 cls
result = ocr.predict(img_path)

print("\n================ 识别结果 ================")
# 新版返回的结果是类似字典的列表
if result:
    for res in result:
        # 提取识别出的文字列表
        texts = res.get('rec_texts', [])
        for text in texts:
            print(text)
print("==========================================")