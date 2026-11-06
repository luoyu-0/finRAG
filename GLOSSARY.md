# 术语表

本文件是项目术语的统一来源。Issue 标题、需求说明、代码、测试与架构讨论应优先使用下表中的术语，避免为同一概念引入同义名称。代码标识符使用英文，文档与日常交流使用中文。

新术语在概念真正形成后登记于此；属于临时实现细节的概念不必登记。登记时同时给出代码中的标识符，便于文档与代码对照。

本表同时收录已实现领域对象和规划概念。`ingestion task`、独立知识库资源、收藏及用户管理相关接口尚未在后端实现；各接口状态以 [系统接口](docs/api/系统接口.md) 为准。

相关文档：[系统架构](docs/architecture/系统架构.md) · [系统接口](docs/api/系统接口.md) · [架构决策记录](docs/adr/) · [开发分工](docs/开发分工.md)

---

## 1 文档与知识库

| 术语 | 标识符 | 定义 |
| --- | --- | --- |
| 制度文档 | document | 一份公开金融制度材料，是导入与解析的基本单位。 |
| 文档标识 | `document_id` | 制度文档的稳定标识；MySQL 与 Milvus 通过它与其它稳定 ID 关联。 |
| 制度版本 | `version_id` | 当前导入器按文件内容摘要生成的版本标识；同一文档只保存当前导入版本，尚无多版本管理表。检索结果保留版本 ID。 |
| 制度状态 | `PolicyStatus` | 制度版本的时效状态，取值为 `active`、`inactive`、`unknown`。 |
| 生效时间 / 失效时间 | `effective_from` / `effective_to` | 制度版本的有效区间，必须带时区；失效时间不得早于生效时间。 |
| 分块 | Chunk / `chunk_id` | 制度正文切分后的最小检索与引用单位。 |
| 条文编号 | `article_number` | 制度内的条款编号（如"第二十条"），用于溯源定位。 |
| 页码 | `page_number` | PDF 分块在原始文件中的页码；TXT 分块为 `null`。 |
| 来源链接 | `source_url` | 分块对应的公开来源地址。 |
| 知识库 | knowledge base / `knowledge_base_id` | 当前是导入和检索的范围 ID，默认 `default`；独立知识库资源及管理接口尚未实现。 |
| 解析方式 | parse method | 取得正文的途径，分为「原生文本提取」与「OCR 识别」。 |
| 解析告警 | parse warning | 解析过程中记录的质量问题；当前在命令行输出，并保存在文档记录的 `parse_warnings` 字段。 |
| 导入任务 | ingestion task | 规划中的上传后异步处理任务；当前使用命令行批量导入，没有任务状态 API。 |

## 2 检索

| 术语 | 标识符 | 定义 |
| --- | --- | --- |
| 检索通道 | retrieval channel | 一种独立的检索方式（如关键词检索、向量检索）；每个通道有唯一 `name`。 |
| 检索器 | `Retriever` | 检索通道的实现端口，返回已按本通道相关性降序排列的结果。 |
| 检索命中 | `RetrievalHit` | 单个检索器返回的一条分块，含正文、来源与原始分数。 |
| 检索过滤条件 | `RetrievalFilters` | 检索前的硬性过滤：知识库范围、目标时间与允许的制度状态。 |
| 融合 | fusion / `FusedHit` | 把多个检索通道的结果合并去重为统一排序；当前实现为 RRF。 |
| 倒数排名融合 | RRF / `ReciprocalRankFusion` | 依据各通道内的**排名**而非原始分数融合，避免不同通道分数量纲不一致。 |
| 重排 | rerank / `Reranker` | 融合之后可选的相关性再排序步骤；失败时回退融合排名并给出警告。 |
| 目标时间 | `effective_at` | 检索所依据的时间点，用于判定制度版本在彼时是否有效；为空时取请求发生时间。 |

## 3 问答与溯源

| 术语 | 标识符 | 定义 |
| --- | --- | --- |
| 标准查询 | `RagQuery` | 进入 RAG 核心流程的统一查询对象：问题、过滤条件与 `top_k`。 |
| 上下文包 | `ContextPackage` | 提供给生成器的证据集合，具有预算边界；被裁剪时标记 `truncated`。 |
| 证据标签 | `label` | 上下文中每条证据的短标识（如 `S1`），生成器回答时用它引用证据。 |
| 生成端口 | `AnswerGenerator` | LLM 生成能力的抽象：只依据给定上下文作答，并返回实际引用的标签。 |
| 生成器输出 | `GeneratorOutput` | 生成端口的结构化返回：回答正文与被引用的证据标签。 |
| 引用 | `Citation` / `citations` | 回答最终采纳的来源，与证据标签一一对应。 |
| 溯源 | citation / traceability | 每条答案都能定位到具体的制度文档、页码或条文。 |
| 证据支持度 | `EvidenceSupport` / `evidence_support` | 当前检索证据对回答的**支持程度**，含 `score`、`level`、`method`、`explanation`。**不是答案正确概率。** |
| 支持等级 | `EvidenceSupportLevel` | 证据支持度的离散等级：`none`、`weak`、`moderate`、`strong`。 |
| 无依据回答 | no-evidence answer | 未检索到有效证据时的固定回复，附空引用与 `none` 等级，**不调用 LLM 猜测答案**。 |
| 请求追踪标识 | `trace_id` | 单次问答请求的追踪标识，用于日志与问题定位。 |
| 警告 | `warnings` | 降级或异常情况的可读提示，如某检索通道不可用、生成上下文被截断。 |

## 4 用户与鉴权

| 术语 | 标识符 | 定义 |
| --- | --- | --- |
| 访问令牌 | Access Token | 短时有效的 JWT（建议 15 分钟）；前端仅保存在内存，经 `Authorization: Bearer` 发送。 |
| 刷新会话 | Refresh Session | 可撤销的长期会话（建议 7 天）；凭据经 `HttpOnly` Cookie 传递，数据库只保存其哈希。 |
| 角色 | role | 权限角色，取值为 `admin` 与 `user`。 |
| 会话撤销 | session revocation | 使 Refresh Session 失效；当前退出和 Token 重放检测会撤销相关 Token 家族，改密与管理员会话管理尚未实现。 |

## 5 接口与错误

| 术语 | 标识符 | 定义 |
| --- | --- | --- |
| 接口前缀 | `/api/v1` | 全部 HTTP API 的统一前缀；OpenAPI 文档位于 `/api/docs`。 |
| 错误码 | `error_code` | 稳定的机器可读错误标识，调用方据其分支处理，**不依赖异常堆栈**。 |
| 错误消息 | `message` | 面向人的可读错误说明。 |
| 通用约定 | — | JSON 字段使用 `snake_case`；时间使用带时区的 ISO 8601 字符串，服务端按 UTC 存储。 |

## 6 工程与流程

| 术语 | 标识符 | 定义 |
| --- | --- | --- |
| 端口抽象 | Provider / Repository / Protocol | 对 LLM、Embedding、OCR、向量库与数据访问的接口隔离，业务代码不直接调用厂商实现。 |
| 架构决策记录 | ADR | 记录一项架构决策的背景、选项、结论与代价，存放于 `docs/adr/`。 |
| 核心模块 | core modules | 覆盖率统计口径中的必测范围：`domain/`、`services/`、`repositories/`、`schemas/`。 |
| 公开开发集 | development set | 用于日常调参与回归的开发数据，可与他人共享。 |
| 验收测试集 | acceptance set | 最终评测所用数据，**不得用于针对性调参**，与公开开发集分开记录。 |
| 知识点 | knowledge point | 命题中「覆盖 1000+ 条核心知识点」的计数单位；具体计数口径待数据到位后确定。 |
| 时效性管理 | policy validity management | 标注制度生效/失效状态，并在问答时优先检索有效条文、过滤过时信息的能力。 |
| 选择性 OCR 路由 | selective OCR routing | 当前先逐页提取 PDF 文字，仅在启用 `--ocr` 且该页提取结果为空时调用 PaddleOCR；更细的质量判断尚未实现。 |
