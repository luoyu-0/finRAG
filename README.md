# 金融制度 RAG 知识问答系统

本项目面向银行监管政策、证券行业规范、保险制度等公开金融制度材料，计划建设一个支持文档导入、知识库构建、混合检索、自然语言问答、条文溯源和时效性管理的 RAG 知识问答系统。

当前仓库已有前端登录与问答界面、MySQL 用户与刷新会话、问答 HTTP 路由、TXT/PDF 离线索引导入、BGE 向量化、Milvus 向量检索、MySQL 中文关键词检索及 DeepSeek 生成 Provider。PDF 无文字层的页面可在离线索引导入时由 PaddleOCR 识别。首次问答需配置 API Key 并导入可检索文件；缺少 Key 时问答返回 `503`，不会显示虚构答案。

## 目标范围

- 导入文本、PDF 和图片类制度文件，扫描件通过 OCR 识别。
- 对制度内容进行解析、清洗、分段、Embedding 和标签管理。
- 结合关键词检索与向量检索生成可追溯答案。
- 标注制度生效、失效状态，优先检索有效条文。
- 提供本地账户登录、用户状态管理和 `admin/user` 两级权限控制。
- 提供问答历史、收藏、来源展示和可信度评分。
- 通过 Docker Compose 统一部署 Web、API、MySQL 和 Milvus。

课程目标要求覆盖至少 1000 条核心知识点，在线问答响应时间不超过 2 秒，人工校验准确率不低于 85%，核心模块单元测试覆盖率不低于 70%。这些指标将在获得代表性数据集后建立统一测量口径。

## 技术方案

| 层次 | 选型 |
| --- | --- |
| 后端 | Python 3.12、FastAPI、LangChain |
| 前端 | React、TypeScript |
| 结构化存储 | MySQL |
| 向量存储 | Milvus |
| LLM | DeepSeek API 已接入；是否满足课程“开源可商用”要求仍待确认 |
| Embedding | [BAAI/bge-small-zh-v1.5](https://huggingface.co/BAAI/bge-small-zh-v1.5)，512 维；通过 Provider 保留替换能力 |
| OCR | PaddleOCR 为主，Tesseract 为备用和对照基线 |
| 用户与鉴权 | 本地账户、短时 JWT Access Token、可撤销 Refresh Session、基础 RBAC |
| 测试 | pytest、前端单元测试、端到端测试、接口测试 |
| 部署 | Docker、Docker Compose |

LLM、Embedding 和向量检索通过适配接口接入，避免业务代码与单一供应商或模型深度绑定。离线索引导入对 TXT 和 PDF 按页原生提取，使用 `--ocr` 时仅对无文字层的 PDF 页面调用 PaddleOCR，并将识别结果写入索引。Embedding 使用 `BAAI/bge-small-zh-v1.5` 的 ONNX 版本，获得正式数据后再决定是否需要替换。

用户系统默认创建 `admin / finrag2026` 管理员，登录页允许用用户名和密码注册普通账户；注册后直接登录。密码只保存安全哈希，Refresh Token 仅保存摘要。用户鉴权、目录边界、PDF 与 OCR 路由统一记录在 [系统架构](docs/architecture/系统架构.md)。

## 仓库结构

```text
finRAG/
├─ backend/                    # FastAPI、RAG、文档处理与后台任务
│  ├─ app/
│  │  ├─ api/v1/              # HTTP API 路由与版本边界
│  │  ├─ core/                # 配置、Token、密码安全、日志及公共能力
│  │  ├─ domain/              # 用户、文档、问答等领域对象与规则
│  │  ├─ repositories/        # MySQL、Milvus 等数据访问抽象
│  │  ├─ schemas/             # API 请求与响应模型
│  │  ├─ services/
│  │  │  ├─ auth/             # 登录、会话、权限与账户安全
│  │  │  ├─ rag/              # 检索、重排、生成与溯源编排
│  │  │  ├─ documents/        # 文档解析、清洗、分段与标签处理
│  │  │  └─ ocr/              # PaddleOCR、Tesseract 适配层
│  │  └─ workers/             # 异步导入与索引任务
│  └─ tests/                  # 后端单元测试与集成测试
├─ frontend/                   # React/TypeScript Web 应用
│  ├─ public/
│  ├─ src/
│  │  ├─ api/                 # 后端接口客户端
│  │  ├─ assets/              # 静态资源
│  │  ├─ components/          # 通用组件
│  │  ├─ features/            # 登录、知识库、问答、历史记录等业务模块
│  │  ├─ layouts/             # 页面布局
│  │  ├─ pages/               # 路由页面
│  │  ├─ router/              # 路由定义
│  │  ├─ stores/              # 客户端状态管理
│  │  └─ types/               # TypeScript 公共类型
│  └─ tests/                  # 前端单元测试与端到端测试
├─ infra/                      # 容器、数据库、向量库及反向代理配置
├─ data/                       # 本地样例、原始文件及处理结果
├─ scripts/                    # 开发、数据处理和部署辅助脚本
└─ docs/                       # 架构、接口、测试、进度及课程文档
```

详细职责和协作边界见 [开发分工文档](docs/开发分工.md)，开发成员和 Agent 的基础规则见 [AGENTS.md](AGENTS.md)，模块、服务与数据关系见 [系统架构](docs/architecture/系统架构.md)，接口契约集中维护在 [系统接口](docs/api/系统接口.md)。

## 环境准备

推荐优先采用 Docker 开发方式，普通使用者不需要分别安装 MySQL、Milvus、PaddleOCR 和 Tesseract。

1. 安装 [Git](https://git-scm.com/downloads)。
2. 安装 [Docker Desktop](https://docs.docker.com/desktop/)，Windows 用户按官方引导启用 WSL 2。
3. 需要脱离容器开发后端时，再安装 [Python 3.12](https://www.python.org/downloads/)；开发前端时安装 [Node.js 24 LTS](https://nodejs.org/en/download)。

安装后可执行以下命令检查环境：

```bash
git --version
docker --version
docker compose version
python --version
node --version
```

首次启动前，从示例创建本地环境变量文件：

```powershell
Copy-Item .env.example .env
```

打开 `.env`，替换两个 MySQL 示例密码。本地开发可将 `JWT_SECRET_KEY` 留空，使用固定开发密钥；正式环境仍须配置独立密钥。启动时确保 `admin / finrag2026` 可用；已有管理员若密码不同，会同步为配置的默认密码并撤销旧刷新会话。其他用户可在登录页自行注册。

在 Windows PowerShell 中，首次启动或修改 Dockerfile、依赖、前端代码后使用 `-Build` 重建镜像：

```powershell
docker compose config
./scripts/start.ps1 -Build
docker compose ps
```

日常启动只需运行 `./scripts/start.ps1`，复用已有镜像。脚本会等待全部服务健康，再读取实际映射端口并打印前端入口；启动失败时不会打印入口。等价的直接命令分别是 `docker compose up -d --build --wait`（重建）和 `docker compose up -d --wait`（复用镜像）。Compose 本身不会在成功后额外打印本项目的入口地址；Linux 环境可执行 `docker compose port frontend 80` 查看实际映射端口。

首次启动需要下载并构建多个镜像，耗时取决于网络。所有服务健康后可以访问：

- 前端登录与问答页：<http://127.0.0.1:3000>
- 后端 API 文档：<http://127.0.0.1:8000/api/docs>
- 后端健康检查：<http://127.0.0.1:8000/api/v1/health>
- Milvus WebUI：<http://127.0.0.1:9091/webui/>
- MinIO 控制台：<http://127.0.0.1:9001>

首次构建会在容器内安装后端依赖、下载 BGE 模型、检查前端 TypeScript 并构建 Vite，因此无需在宿主机预装 Node.js 或 Python。后端镜像构建时还会通过 Debian 软件源安装 PaddleOCR/OpenCV 所需的系统库；这不是容器每次启动都要执行的步骤。Compose 默认使用清华 Debian 镜像站加快当前开发环境的首次构建，其他网络可在 `.env` 中设置 `DEBIAN_MIRROR` 和 `DEBIAN_SECURITY_MIRROR` 切换软件源。若 `DEEPSEEK_API_KEY` 为空，使用管理员登录后问答页会显示 `RAG_RETRIEVAL_UNAVAILABLE`；配置 Key 并重启后，可先导入文件再问答。问答接口的 `answer` 字段现返回 Markdown 字符串，引用和证据支持度仍在独立字段中；前端 Markdown 渲染由后续适配完成。前端单元测试仍使用隔离的 Mock 数据，开发与生产构建都调用真实接口。可通过以下命令再次确认服务状态：

```bash
docker compose ps
```

### 导入 TXT 与 PDF

将已获授权的 `.txt`、`.pdf` 放入 `data/raw/`，可建子目录。默认知识库 ID 为 `default`；缺少状态元数据时按团队本次决定默认标为 `active` 并参与检索。正式数据到位后应核对时效性，过期文件请在 `data/raw/metadata.json` 中显式标为 `inactive` 后重新导入。元数据以相对路径为键：

```json
{
  "制度/示例.pdf": {
    "title": "示例制度",
    "policy_status": "active",
    "effective_from": "2026-01-01T00:00:00+08:00",
    "effective_to": null,
    "source_url": "https://example.org/policy.pdf"
  }
}
```

导入命令会按文件内容生成稳定版本 ID，并结合文档 ID 生成分块 ID，避免内容相同的不同文件发生主键冲突；再次运行会更新同一文件的索引。由旧版分块 ID 规则升级时需重新运行导入命令以重建索引，已有问答历史中的旧分块 ID 可能无法再定位到新索引。单个文件限 50 MB。若使用非默认知识库，在命令末尾加 `--knowledge-base-id <ID>`，问答页也应选相同知识库。

当前代码中的线上导入分块策略按章、节、条和段落等边界优先切分，单块最多 500 字符，相邻长块重叠 50 字符；修改分块规则或原文后须重新导入相应文件，才会影响在线问答。基于本地原始制度文件核对的 50 组问答样本见 [问答基准集](data/samples/qa_50_from_raw.json)。重建这 10 份来源文件的索引后，可从后端运行评测并在 `data/processed/qa_evaluation.json`、`data/processed/qa_evaluation.md` 查看逐题回答、引用命中和汇总结果：

```powershell
$samplePath = (Resolve-Path data/samples).Path
docker compose run --rm --no-deps --volume "${samplePath}:/app/data/samples:ro" backend python -m app.workers.evaluate_qa
```

评测会先校验原文哈希、证据摘录和索引文件版本；不一致时需先重新导入。可加 `--limit 1` 仅跑首题检查。评测会真实调用 DeepSeek API，文本相似度仅供辅助比较，答案事实和引用仍需人工审核。

```powershell
docker compose exec backend python -m app.workers.import_documents
```

扫描版或部分页面没有文字层的 PDF，使用一次性容器执行选择性 OCR 导入。首次运行会下载 PaddleOCR 模型并保存在 Docker 卷中；处理时间取决于扫描页数。识别页会记录“需人工复核”告警，重要制度和条文应核对原 PDF。若只需导入部分文件，在 `data/processed/ocr-targets.txt` 中逐行写入相对于 `data/raw/` 的路径，再加 `--paths-file /app/data/processed/ocr-targets.txt`。

```powershell
docker compose run --rm --no-deps backend python -m app.workers.import_documents --ocr
```

导入失败会列出文件和原因。当前使用 MySQL 中文 ngram 关键词检索与 Milvus 向量检索融合；上传管理界面、导入任务进度和 PDF 复杂版面处理仍未实现。若数据库已有旧版 `document_chunks` 表且缺少 `ix_document_chunks_text_ngram` 索引，需先按 `infra/mysql/0001_document_fulltext.sql` 补建索引。

停止容器但保留数据：

```bash
docker compose down
```

`docker compose down -v` 会同时删除 MySQL、Milvus、MinIO、etcd 数据卷和 OCR 模型缓存卷，仅在明确需要重置环境时使用。

### 离线文档解析与 OCR

将已获准使用的 `.txt`、`.pdf`、`.jpg`、`.jpeg` 或 `.png` 文件分别放到 `data/raw/txts/`、`data/raw/pdfs/`、`data/raw/images/`。首次使用时自行创建这些目录；`data/raw/` 中的原始文件不会提交到仓库。执行以下命令运行一次性导入容器，结果写入 `data/processed/chunks.jsonl`：

```bash
docker compose run --rm --no-deps backend python process_docs.py
```

该命令复用后端镜像，但 OCR 在独立的一次性容器中执行，不占用在线问答进程。首次识别扫描件或图片时 PaddleOCR 可能下载模型文件；纯文本文件不会初始化 OCR 模型。每次运行都会覆盖 `chunks.jsonl`；这个独立调试脚本只完成解析与切分，不写入 Milvus。需要参与问答的 PDF 请使用上文的 `app.workers.import_documents --ocr` 命令。图片单文件调试可运行 `docker compose run --rm --no-deps backend python test_ocr.py "/app/data/raw/images/文件名.png"`。

文件解析回归测试使用 `cd backend` 后执行 `python -m pytest tests/integration/test_document_import.py`。测试用临时 PDF 和 OCR Stub，不下载模型，也不调用外部服务。

### Windows 常见启动问题

如果构建阶段无法访问 `auth.docker.io` 或 `registry-1.docker.io`，并出现 `failed to fetch oauth token`，通常是 Docker Desktop 未正确使用当前 VPN、代理或 DNS。可先关闭 Docker Desktop，执行 `ipconfig /flushdns` 和 `wsl --shutdown`，再确认 VPN 的系统代理或 TUN 模式已经覆盖 Docker Desktop 后重试。不建议为临时网络问题修改 Dockerfile 或使用来源不明的镜像加速地址。

如果本机已经安装 MySQL，宿主机 `3306` 端口可能被占用。此时只需在本地 `.env` 中调整映射端口，例如：

```dotenv
MYSQL_HOST_PORT=3307
```

该设置只改变宿主机访问端口；后端容器仍通过服务名 `mysql:3306` 连接数据库，因此无需修改应用配置或提交个人 `.env` 文件。

### 前端本地开发与检查

脱离容器开发前端时，在 `frontend/` 目录执行：

```bash
npm ci            # 严格按 package-lock.json 安装依赖
npm run dev       # 开发服务器，/api 请求自动代理到 http://127.0.0.1:8000
```

提交前建议执行以下检查；GitHub Actions 会对同一组命令做自动化校验：

```bash
npm run lint          # oxlint 代码检查
npm run format:check  # Prettier 格式检查
npm run typecheck     # tsc 类型检查（src 与配置文件两份 tsconfig）
npm run test:coverage # Vitest 单元测试与覆盖率
npm run build         # 类型检查 + Vite 生产构建
```

端到端测试由 Playwright 负责，面向容器化后的真实拓扑（前端默认监听 3000），首次运行需先安装浏览器：

```bash
npx playwright install chromium
$env:E2E_ADMIN_PASSWORD="<与 .env 中的初始管理员密码一致>"
npm run test:e2e
```

如果 Windows 将 3000 端口划入系统保留范围，可临时设置 `FRONTEND_PORT=3200` 启动容器，并将 `PLAYWRIGHT_BASE_URL` 设置为 `http://127.0.0.1:3200` 后再执行测试。

当前冒烟用例验证 React 页面真实渲染，以及前端 Nginx 经 `/api` 反向代理访问后端健康接口。CI 会自动构建并启动 `mysql`、`backend` 和 `frontend` 后执行同一用例。

代码检查使用 oxlint 而非 ESLint：`typescript-eslint` 与 `@typescript-eslint/parser` 目前要求 TypeScript `<6.1.0`，与本项目锁定的 TypeScript 7 冲突，oxlint 自带解析器不受该限制。覆盖率当前只统计不设门槛，核心模块 70% 的目标待业务模块与测试就位后逐步抬升并在 CI 中硬卡。

## 运行环境规划

- **当前主要环境**：普通 Windows 11 个人电脑，通过 Docker Desktop 和 Docker Compose 启动各项服务。
- **跨环境部署**：容器配置不依赖 Windows 专属路径，使用环境变量、命名卷、健康检查和相对构建上下文，确保后续能够迁移到 Linux 服务器。
- **云端环境**：服务器配置和验收方式等待评测方通知，在规格明确前不针对假定资源做专用裁剪。
- **外部服务**：若采用 DeepSeek，则通过 API 调用；密钥只通过环境变量注入，不写入镜像或仓库。

当前 Compose 使用 Milvus Standalone。按照 [Milvus 官方要求](https://milvus.io/docs/prerequisite-docker.md)，Docker Desktop 需要分配至少 8 GB 内存；若本机资源不足，可暂时只启动前后端与 MySQL，待后续开发向量检索时再启动 Milvus。

```bash
docker compose up -d --build mysql backend frontend
```

## 协作约定

- 功能分支使用 `feature/<模块>-<说明>`，修复分支使用 `fix/<模块>-<说明>`。
- 提交信息应说明“做了什么”，一次提交只处理一类变更。
- 跨模块接口先更新 `docs/api/` 中的契约，再分别实现前后端。
- 合并前至少完成所属模块测试，并由一名非作者成员审查。
- 禁止提交真实密钥、个人环境文件、数据库运行数据和未经许可的金融材料。
- 金融制度测试数据仅使用监管机构公开材料或企业明确允许使用的公开文档。

## 当前状态

- [x] 明确总体技术栈与模块边界
- [x] 初始化仓库目录与团队分工
- [ ] 确认最终 LLM 方案；当前候选为 DeepSeek API，需确认课程合规性
- [x] 确定初始 Embedding 方案
- [x] 确定本地 Docker 为当前主要部署方式
- [ ] 等待首批公开制度数据和企业验收测试集
- [ ] 等待评测方确认云服务器配置和验收方式
- [ ] 确定 API 契约、数据模型与切分策略
- [x] 初始化后端、前端及 Docker Compose 配置
- [x] 在 Windows 11 + Docker Desktop 上完成全量容器构建和健康检查验证
- [x] 完成用户鉴权架构与选择性 OCR 路由规划
- [x] 实现 RAG 在线核心领域模型、混合检索融合、上下文、引用与证据支持度
- [x] 接入 Milvus 向量检索、BGE Embedding 和 DeepSeek 生成 Provider
- [x] 实现 TXT/文字型 PDF 到向量索引的离线导入
- [x] 接入 MySQL 中文关键词检索与向量融合
- [ ] 接入 Reranker，并实现导入管理界面
- [ ] 用正式数据验证端到端问答质量与课程指标

