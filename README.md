# 金融制度 RAG 知识问答系统

导入金融制度文档后，可用自然语言提问，并通过回答中的引用查看原文。系统提供知识库管理、文档上传、问答历史和收藏。

## 启动与关闭

启动 Docker（Windows 上打开 Docker Desktop），在仓库根目录执行以下命令。

**首次配置**时，如果还没有 `.env`，将 [.env.example](.env.example) 复制为 `.env`，设置 `MYSQL_ROOT_PASSWORD` 和 `MYSQL_PASSWORD`。如需使用问答功能，再填写 `DEEPSEEK_API_KEY`。

| 操作 | 命令 |
| --- | --- |
| 首次启动或改动代码、依赖后重建 | `docker compose up -d --build --wait` |
| 日常启动 | `docker compose up -d --wait` |
| 关闭服务并保留数据库和索引 | `docker compose down` |
| 查看服务状态 | `docker compose ps` |

启动完成后，打开默认网页地址 <http://127.0.0.1:3000>。默认开发管理员为 `admin`，初始密码为 `finrag2026`，可通过 `.env` 中的 `ADMIN_BOOTSTRAP_USERNAME` 和 `ADMIN_BOOTSTRAP_PASSWORD` 配置。普通用户可以在登录页注册。API 文档默认在 <http://127.0.0.1:8000/api/docs>。

如果修改了 `FRONTEND_PORT`，可用 `docker compose port frontend 80` 查看实际端口。

## 导入文档与问答

使用管理员账号在文档导入页上传文件，等待导入任务完成。问答需配置 DeepSeek API Key，默认检索当前有效的制度文档。

在「文档导入」页可选一个或多个文件，提交后查看各文件的任务状态。知识库详情页的「导入文档」会预选该库。上传使用 `POST /api/v1/documents/batch`，每批最多 20 个文件，总大小不超过 48 MiB。参数、大小限制和轮询方式见 [批量上传接口](docs/api/系统接口.md#811-批量上传)。

离线批量导入时，把获准使用的 TXT、PDF 放到 `data/raw/` 下，在仓库根目录执行以下命令。扫描版 PDF 使用带 `--ocr` 的命令识别无文字层的页面。

```powershell
docker compose exec backend python -m app.workers.import_documents
docker compose run --rm --no-deps backend python -m app.workers.import_documents --ocr
```

默认导入到 `default` 知识库。导入其他知识库时，在命令末尾加上 `--knowledge-base-id <ID>`。元数据、重复文件和 OCR 重建规则见 [批量导入](docs/testing/现有数据批量导入与问答回归.md)、[内容去重](docs/testing/文档内容去重.md)和 [OCR 联调](docs/testing/离线导入与OCR联调.md)。

离线导入器默认排除部门决算、部门预算、财务报表等机构内部财务材料；放入 `data/raw/_excluded/` 的文件也会自动跳过。确需保留时可加 `--include-excluded`。已入库的旧索引先预览，再按确认过的文档 ID 清理。可重复传入 `--document-id`：

```powershell
docker compose run --rm --no-deps backend python -m app.workers.prune_off_topic
docker compose run --rm --no-deps backend python -m app.workers.prune_off_topic --apply --document-id "替换为预览中的文档ID"
```

PDF 解析会清理重复页眉页脚和页码、把跨页断开的自然段拼回去，并把文字型表格转成竖线分隔的行。解析规则改变后，已有文档需加 `--rebuild` 重建索引；扫描件中的表格目前仍只按 OCR 文本处理，不还原行列结构。

## 开发与排查

- `frontend/` 使用 React 和 TypeScript，在该目录运行 `npm ci`、`npm run dev`。后端在 `backend/`，使用 FastAPI、LangChain、MySQL、Milvus 和 DeepSeek。部署配置位于 `compose.yaml` 和 `infra/`。
- 启动异常时用 `docker compose ps` 和 `docker compose logs --tail=100 backend` 检查状态。端口、构建镜像源和应用配置见 [.env.example](.env.example)。
- 调试模型收发时，在本地 `.env` 设置 `DEEPSEEK_LOG_CONTENT=1`，运行 `docker compose up -d backend` 使配置生效，再用 `docker compose logs -f backend` 查看。日志包含完整问题、证据和回复，调试结束后将开关设回 `0` 并重新执行 `docker compose up -d backend`。
- 流式失败时，后端会记录失败阶段、模型结束原因、已发送字符数和证据块数。该诊断日志无需开启正文日志。

## 文档索引

- [完整文档索引](docs/README.md)
- [系统架构](docs/architecture/系统架构.md)与 [API 契约](docs/api/系统接口.md)
- [后端测试](docs/testing/后端单元测试与覆盖率.md)、[RAG 延迟评测](docs/testing/RAG效果与首字延迟优化.md)与 [RRF 排序对照](docs/testing/RAG融合排序与上下文对照.md)
- [开发分工](docs/开发分工.md)与 [协作规范](AGENTS.md)
