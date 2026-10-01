# 金融制度 RAG 知识问答系统

本项目面向银行监管政策、证券行业规范、保险制度等公开金融制度材料，计划建设一个支持文档导入、知识库构建、混合检索、自然语言问答、条文溯源和时效性管理的 RAG 知识问答系统。

当前仓库仅完成协作目录初始化，尚未加入业务逻辑、依赖配置和可运行服务。

## 目标范围

- 导入文本、PDF 和图片类制度文件，扫描件通过 OCR 识别。
- 对制度内容进行解析、清洗、分段、Embedding 和标签管理。
- 结合关键词检索与向量检索生成可追溯答案。
- 标注制度生效、失效状态，优先检索有效条文。
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
| LLM | DeepSeek API |
| Embedding | [BAAI/bge-small-zh-v1.5](https://huggingface.co/BAAI/bge-small-zh-v1.5)，512 维；通过 Provider 保留替换能力 |
| OCR | PaddleOCR 为主，Tesseract 为备用和对照基线 |
| 测试 | pytest、前端单元测试、端到端测试、接口测试 |
| 部署 | Docker、Docker Compose |

LLM、Embedding、OCR 和向量检索将通过适配接口接入，避免业务代码与单一供应商或模型深度绑定。文本型 PDF 优先直接提取文本，仅对无有效文本层的页面执行 OCR。Embedding 初选轻量中文模型 `BAAI/bge-small-zh-v1.5`，兼顾中文检索效果与本地部署成本；获得正式数据后再决定是否需要替换。

## 仓库结构

```text
finRAG/
├─ backend/                    # FastAPI、RAG、文档处理与后台任务
│  ├─ app/
│  │  ├─ api/v1/              # HTTP API 路由与版本边界
│  │  ├─ core/                # 配置、安全、日志及公共基础能力
│  │  ├─ domain/              # 核心领域对象与规则
│  │  ├─ repositories/        # MySQL、Milvus 等数据访问抽象
│  │  ├─ schemas/             # API 请求与响应模型
│  │  ├─ services/
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
│  │  ├─ features/            # 知识库、问答、历史记录等业务模块
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

详细职责和协作边界见 [开发分工文档](docs/开发分工.md)，开发成员和 Agent 的基础规则见 [AGENTS.md](AGENTS.md)。

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

目前尚未提供启动命令。后续完成依赖与 Compose 配置后，将在本节补充一条命令启动和常见问题说明。

## 运行环境规划

- **当前主要环境**：普通 Windows 11 个人电脑，通过 Docker Desktop 和 Docker Compose 启动各项服务。
- **跨环境部署**：容器配置不依赖 Windows 专属路径，使用环境变量、命名卷、健康检查和相对构建上下文，确保后续能够迁移到 Linux 服务器。
- **云端环境**：服务器配置和验收方式等待评测方通知，在规格明确前不针对假定资源做专用裁剪。
- **外部服务**：DeepSeek 通过 API 调用；密钥只通过环境变量注入，不写入镜像或仓库。

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
- [x] 确定 DeepSeek 与初始 Embedding 方案
- [x] 确定本地 Docker 为当前主要部署方式
- [ ] 等待首批公开制度数据和企业验收测试集
- [ ] 等待评测方确认云服务器配置和验收方式
- [ ] 确定 API 契约、数据模型与切分策略
- [ ] 初始化后端、前端及 Docker Compose 配置
- [ ] 实现最小可运行的端到端流程

