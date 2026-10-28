/**
 * 文档导入页。
 *
 * 对应 docs/api/系统接口.md §8.1（上传）、§8.5（任务列表）、§8.7（重试）。
 *
 * 上传只落盘并创建导入任务（后端返回 202），解析、OCR、切分与向量化在后台
 * 异步完成，因此上传成功后轮询任务列表，而不是等待请求返回解析结果。
 */
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { listTasks, retryTask, uploadDocument } from "../../api/documents";
import { ApiError } from "../../api/errors";
import { listKnowledgeBases } from "../../api/knowledge";
import { apiClient } from "../../api/session";
import { PageState } from "../../components/PageState";
import { TaskProgress } from "../../components/TaskProgress";
import { useLoader } from "../../hooks/useLoader";
import { ACCEPTED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "../../types/knowledge";
import type { IngestionTask, KnowledgeBase } from "../../types/knowledge";
import type { Page } from "../../types/api";

const POLL_INTERVAL_MS = 2000;
const ACCEPT_ATTR = ".pdf,.png,.jpg,.jpeg,.txt,.md,.docx";
const ALLOWED_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "txt", "md", "docx"];

function validateFile(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return `文件大小 ${mb} MB，超过 50 MB 上限。`;
  }

  const allowed: readonly string[] = [...ACCEPTED_UPLOAD_TYPES];
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

  // 部分浏览器对本地文件不给出 MIME，此时按扩展名兜底。
  if (file.type !== "") {
    return allowed.includes(file.type) ? null : `不支持的文件类型：${file.type}。`;
  }
  return ALLOWED_EXTENSIONS.includes(extension) ? null : `不支持的文件扩展名：.${extension}。`;
}

export function ImportPage() {
  const [searchParams] = useSearchParams();
  const presetKnowledgeBaseId = searchParams.get("kb") ?? "";

  const knowledgeBaseFetcher = useCallback(
    () => listKnowledgeBases(apiClient, { page_size: 100 }),
    [],
  );
  const taskFetcher = useCallback(() => listTasks(apiClient, { page_size: 10 }), []);

  const knowledgeBaseLoader = useLoader<Page<KnowledgeBase>>(knowledgeBaseFetcher);
  const taskLoader = useLoader<Page<IngestionTask>>(taskFetcher);
  const reloadTasks = taskLoader.reload;
  const refreshTasks = taskLoader.refresh;

  const [selectedId, setSelectedId] = useState(presetKnowledgeBaseId);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const knowledgeBases = knowledgeBaseLoader.data?.items ?? [];
  const knowledgeBaseId = selectedId !== "" ? selectedId : (knowledgeBases[0]?.id ?? "");

  const tasks = taskLoader.data?.items ?? [];
  const hasActiveTask = tasks.some(
    (task) => task.state === "queued" || task.state === "processing",
  );

  useEffect(() => {
    if (!hasActiveTask) {
      return;
    }
    const timer = setInterval(() => {
      refreshTasks();
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [hasActiveTask, refreshTasks]);

  function pickFile(next: File | null): void {
    setFileError(null);
    setNotice(null);
    if (next === null) {
      setFile(null);
      return;
    }
    const message = validateFile(next);
    if (message !== null) {
      setFileError(message);
      setFile(null);
      return;
    }
    setFile(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (file === null || knowledgeBaseId === "") {
      return;
    }

    setUploading(true);
    setUploadError(null);
    setNotice(null);
    try {
      const result = await uploadDocument(apiClient, {
        file,
        knowledgeBaseId,
        title: title.trim() === "" ? undefined : title.trim(),
      });
      setNotice(
        `已提交「${result.document.title}」，导入任务 ${result.ingestion_task.id} 正在后台处理。`,
      );
      setFile(null);
      setTitle("");
      reloadTasks();
    } catch (caught) {
      setUploadError(caught instanceof ApiError ? caught.message : "上传失败，请稍后重试。");
    } finally {
      setUploading(false);
    }
  }

  async function handleRetry(taskId: string): Promise<void> {
    setActionError(null);
    try {
      await retryTask(apiClient, taskId);
      reloadTasks();
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "重试失败，请稍后重试。");
    }
  }

  return (
    <div className="stack stack--section">
      <div className="page-head">
        <div>
          <h2 className="page-head__title">文档导入</h2>
          <p className="page-head__desc">
            上传制度材料后，系统在后台完成正文提取、选择性 OCR、条文切分与向量化。
          </p>
        </div>
        {presetKnowledgeBaseId !== "" ? (
          <div className="page-head__actions">
            <Link className="btn btn--ghost" to={`/knowledge/${presetKnowledgeBaseId}`}>
              返回知识库
            </Link>
          </div>
        ) : null}
      </div>

      <section className="card">
        <div className="card__header">
          <h3 className="card__title">上传文件</h3>
          <span className="faint">单个文件上限 50 MB</span>
        </div>

        <div className="card__body">
          <form className="stack" onSubmit={(event) => void handleSubmit(event)}>
            <label className="field">
              <span className="field__label">归属知识库</span>
              <select
                className="field__input"
                value={knowledgeBaseId}
                onChange={(event) => setSelectedId(event.target.value)}
                required
              >
                <option value="">请选择知识库</option>
                {knowledgeBases.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              {knowledgeBases.length === 0 ? (
                <span className="field__hint">尚未加载到知识库，请先在「知识库」页面创建。</span>
              ) : null}
            </label>

            <div className="upload">
              <label className="upload__drop" htmlFor="upload-file">
                <span className="upload__file">{file === null ? "点击选择文件" : file.name}</span>
                <span className="upload__hint">
                  支持 PDF、PNG、JPEG、TXT、Markdown 与 DOCX；扫描件会走 OCR 通道。
                </span>
                <input
                  id="upload-file"
                  className="sr-only"
                  type="file"
                  accept={ACCEPT_ATTR}
                  aria-label="选择文件"
                  onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
                />
              </label>

              {file !== null ? (
                <span className="faint">已选择 {(file.size / 1024).toFixed(0)} KB</span>
              ) : null}
            </div>

            {fileError ? (
              <p className="field__error" role="alert">
                {fileError}
              </p>
            ) : null}

            <label className="field">
              <span className="field__label">标题（可选）</span>
              <input
                className="field__input"
                value={title}
                maxLength={200}
                placeholder="留空时使用文件名"
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>

            {uploadError ? (
              <p className="field__error" role="alert">
                {uploadError}
              </p>
            ) : null}

            {notice ? <p className="field__hint">{notice}</p> : null}

            <div className="row">
              <button
                type="submit"
                className="btn"
                disabled={uploading || file === null || knowledgeBaseId === ""}
              >
                {uploading ? "上传中…" : "提交导入"}
              </button>
              <span className="faint">提交后可在下方任务列表查看解析进度。</span>
            </div>
          </form>
        </div>
      </section>

      <section className="card">
        <div className="card__header">
          <h3 className="card__title">导入任务</h3>
          <div className="row">
            {hasActiveTask ? <span className="faint">处理中，每 2 秒自动刷新</span> : null}
            <button type="button" className="btn btn--ghost btn--sm" onClick={reloadTasks}>
              刷新
            </button>
          </div>
        </div>

        <div className="card__body">
          {actionError ? (
            <p className="field__error" role="alert">
              {actionError}
            </p>
          ) : null}

          {taskLoader.loading ? (
            <PageState kind="loading" title="正在加载导入任务…" />
          ) : taskLoader.error ? (
            <PageState
              kind="error"
              title="加载导入任务失败"
              description={taskLoader.error.message}
              errorCode={taskLoader.error.code}
              actions={
                <button type="button" className="btn btn--ghost" onClick={reloadTasks}>
                  重试
                </button>
              }
            />
          ) : tasks.length > 0 ? (
            <div>
              {tasks.map((task) => (
                <div key={task.id}>
                  <TaskProgress task={task} />
                  {task.state === "failed" ? (
                    <div className="row mt-2">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => void handleRetry(task.id)}
                      >
                        重试任务
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <PageState
              title="还没有导入任务"
              description="上传文档后，这里会显示解析、OCR 与向量化的进度。"
            />
          )}
        </div>
      </section>
    </div>
  );
}
