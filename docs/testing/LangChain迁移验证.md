# LangChain 迁移验证

## 范围

在线问答使用 LangChain LCEL 的异步链执行检索、融合与上下文、生成与引用校验。DeepSeek 使用官方 `ChatDeepSeek`，提示模板与严格 JSON 解析通过 LCEL 连接。依赖固定为 `langchain-core==1.7.6`、`langchain-deepseek==1.1.1`。

MySQL/Milvus Repository、BGE、OCR、500 字符分块与 50 字符重叠规则保持原实现。API 字段、错误码和引用来源不变，无数据结构迁移要求。

## 自动化回归

在 Python 3.12 环境安装 `backend/requirements-dev.txt` 后，从 `backend` 目录运行：

```powershell
$env:DEEPSEEK_API_KEY=""
python -m pytest --cov=app.services.rag --cov-report=term-missing
python -m pip check
```

测试期间必须清空真实 API Key，避免应用生命周期初始化真实模型和存储。适配器测试使用真实 ChatDeepSeek 与模拟 HTTP 响应，验证请求参数、提示内容、引用、截断、无效 JSON 和 HTTP 错误；RAG 回归覆盖无证据短路、有效状态过滤、单通道降级、重排降级和并发请求上下文隔离。

2026-11-06 在 Docker Python 3.12 环境执行：61 项测试全部通过（含 10 项内容去重集成测试），RAG 模块覆盖率 85%，`pip check` 通过。85% 仅指 RAG 模块，不代表包含导入 CLI 的总体覆盖率。生成失败日志仅记录异常类型；测试验证敏感异常正文不会进入日志。SDK 的截断异常仍转换为生成结果不完整错误，HTTP 错误契约不变。

## 真实模型验证

2026-11-06 使用基准集第一题的证据摘录直接调用新生成链，成功返回 `### 结论` Markdown 和 `[S1]`，引用标签为 `S1`。该检查证明模型适配可用，不代表检索质量评测。

## 部署验证

使用项目既有构建参数指定清华 PyPI 镜像完成后端构建，个人 `.env` 未修改：

```powershell
docker compose build --build-arg PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple backend
docker compose up -d --no-deps --wait --wait-timeout 180 backend
docker compose exec -T backend pip check
```

新后端进入 healthy，依赖检查通过；实际登录后请求问答接口返回 HTTP 200，空索引下返回 Markdown 依据不足答复，无引用和告警。

有资料后的一次真实问答曾返回 502；同题服务层复测成功，后续 3 次 HTTP 调用及固定上下文的 10 次生成均成功，均返回 2 条引用。首个失败未取得底层异常且未再次复现，原因未确认，不能标记为已修复；未据此修改提示词或放宽引用校验。

## 固定集检索评测

使用同一批索引分别运行替换前后的 50 题，保存不同报告路径，比较来源命中、条文命中和逐题回答。调用会消耗 DeepSeek API 额度；字面相似度不能代替人工事实核验。

```powershell
$samplePath = (Resolve-Path data/samples).Path
docker compose run --rm --no-deps --volume "${samplePath}:/app/data/samples:ro" backend python -m app.workers.evaluate_qa --output /app/data/processed/qa_langchain.json
```

本轮最初的运行库为空；在用户授权后已恢复完整 TXT/PDF 语料，再执行真实评测。没有取得替换前使用同一索引的基线，不能与旧报告直接宣称效果持平或提升。

### 导入与索引检查

- 667 份 TXT/PDF 按同知识库内文件字节 SHA-256 去重后为 443 份：128 份 PDF、315 份 TXT，224 份重复副本不重复存储。
- 经用户授权清理已入库的 17 份重复副本索引，raw 原文件保留。
- MySQL 和 Milvus 均为 10,914 个分块；完整 ID 集合比对没有缺失或孤立向量，最大分块长度为 500 字符。
- 全量再次导入：667 份全部跳过，0 新增、0 失败。
- OCR 有 328 页识别出文字，83 页没有可用文字，运行异常为 0。无文字页可能为空白页或识别遗漏，尚未经逐页人工核对；1 份 WPS 按用户要求暂不处理。
- 索引检查报告：`data/processed/index_validation_langchain_2026-11-06.json`。

### 50 题首次完整评测

报告：`data/processed/qa_langchain_2026-11-06.json` 及同名 `.md`，包含标准答案、实际回答、引用与逐题指标。

完成 49/50，失败 1 题。成功的 49 题中，来源命中 48 题（98.0%）、条文命中 35 题（71.4%），平均文本相似度 33.0%。若以全部 50 题为分母，来源命中为 96.0%、条文命中为 70.0%。命中与文本相似度均不能替代答案事实正确性审核。

第 25 题出现 `JSONDecodeError`，接口层转换为 `GenerationFailedError`。保留首次失败报告，不通过放宽 JSON 校验或调整固定测试题来掩盖问题；这表明真实生成仍存在偶发格式失败，不能宣称 50 题全部通过。

同题独立复测 3 次均成功，结果另存于 `data/processed/qa_langchain_case25_recheck_2026-11-06.json` 及同名 `.md`，未覆盖首次报告。未稳定复现原始格式错误，无法确认其更细的触发条件，也未据此宣称已修复。

## 参考

- [LangChain Runnable 编排接口](https://reference.langchain.com/python/langchain-core/runnables)
- [官方 ChatDeepSeek 集成](https://docs.langchain.com/oss/python/integrations/chat/deepseek)
