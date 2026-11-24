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

import {
  getTask,
  listTasks,
  retryTask,
  uploadDocument,
  uploadDocumentBatch,
} from "../../api/documents";
import { ApiError } from "../../api/errors";
import { listKnowledgeBases } from "../../api/knowledge";
import { apiClient } from "../../api/session";
import { PageState } from "../../components/PageState";
import { TaskProgress } from "../../components/TaskProgress";
import { useLoader } from "../../hooks/useLoader";
import { ACCEPTED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "../../types/knowledge";
import type { IngestionTask, KnowledgeBase, UploadDocumentResponse } from "../../types/knowledge";
import type { Page } from "../../types/api";

const POLL_INTERVAL_MS = 2000;
const MAX_BATCH_FILES = 20;
const MAX_BATCH_BYTES = 48 * 1024 * 1024;

function isActiveTask(task: IngestionTask): boolean {
  return task.state === "queued" || task.state === "processing";
}
const ACCEPT_ATTR = ".pdf,.png,.jpg,.jpeg,.txt,.md,.docx";
const ALLOWED_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "txt", "md", "docx"];

function validateFile(file: File, batch: boolean): string | null {
  if (batch) {
    if (file.size === 0) return "文件为空。";
    const dot = file.name.lastIndexOf(".");
    if (dot <= 0 || !ALLOWED_EXTENSIONS.includes(file.name.slice(dot + 1).toLowerCase())) {
      return "不支持的文件类型。";
    }
    if (new TextEncoder().encode(file.name).length > 255) return "文件名过长。";
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return `文件大小 ${mb} MB，超过 50 MB 上限。`;
  }

  if (batch) return null;

  const allowed: readonly string[] = [...ACCEPTED_UPLOAD_TYPES];
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

  // 部分浏览器对本地文件不给出 MIME，此时按扩展名兜底。
  if (file.type !== "") {
    return allowed.includes(file.type) ? null : `不支持的文件类型：${file.type}。`;
  }
  return ALLOWED_EXTENSIONS.includes(extension) ? null : `不支持的文件扩展名：.${extension}。`;
}

export function ImportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const batch = searchParams.get("mode") === "batch";
  const [batchItems, setBatchItems] = useState<UploadDocumentResponse[]>([]);
  const currentBatch = batch ? batchItems : null;
  const presetKnowledgeBaseId = searchParams.get("kb") ?? "";

  const knowledgeBaseFetcher = useCallback(
    () => listKnowledgeBases(apiClient, { page_size: 100 }),
    [],
  );
  const taskFetcher = useCallback(async () => {
    const result = await listTasks(apiClient, {
      page_size: currentBatch?.length ? MAX_BATCH_FILES : 10,
    });
    if (!currentBatch?.length) return result;

    const recent = new Map(result.items.map((task) => [task.id, task]));
    const items = await Promise.all(
      currentBatch.map(
        ({ ingestion_task }) =>
          recent.get(ingestion_task.id) ?? getTask(apiClient, ingestion_task.id),
      ),
    );
    return { ...result, items };
  }, [currentBatch]);

  const knowledgeBaseLoader = useLoader<Page<KnowledgeBase>>(knowledgeBaseFetcher);
  const taskLoader = useLoader<Page<IngestionTask>>(taskFetcher);
  const reloadTasks = taskLoader.reload;
  const refreshTasks = taskLoader.refresh;

  const [selectedId, setSelectedId] = useState(presetKnowledgeBaseId);
  const [selection, setSelection] = useState<{ batch: boolean; files: File[] } | null>(null);
  const files = selection?.batch === batch ? selection.files : [];
  const [title, setTitle] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const knowledgeBases = knowledgeBaseLoader.data?.items ?? [];
  const knowledgeBaseId = selectedId !== "" ? selectedId : (knowledgeBases[0]?.id ?? "");

  const loadedTasks = taskLoader.data?.items ?? [];
  const batchFiles = new Map(
    currentBatch?.map((item) => [item.ingestion_task.id, item.document.file_name]),
  );
  const tasks = currentBatch?.length
    ? currentBatch.map(
        ({ ingestion_task }) =>
          loadedTasks.find((task) => task.id === ingestion_task.id) ?? ingestion_task,
      )
    : loadedTasks;
  const hasActiveTask = tasks.some(isActiveTask);

  useEffect(() => {
    if (!hasActiveTask || taskLoader.loading) {
      return;
    }
    const timer = setInterval(() => {
      refreshTasks();
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [hasActiveTask, refreshTasks, taskLoader.loading]);

  function switchMode(): void {
    const next = new URLSearchParams(searchParams);
    if (batch) next.delete("mode");
    else next.set("mode", "batch");
    setSearchParams(next);
    setSelection(null);
    setFileError(null);
    setNotice(null);
    setUploadError(null);
  }

  function pickFiles(next: File[]): void {
    setSelection(null);
    setFileError(null);
    setUploadError(null);
    setNotice(null);
    if (batch && next.length > MAX_BATCH_FILES) {
      setFileError("每批最多选择 20 个文件，请重新选择。");
      return;
    }
    for (const file of next) {
      const message = validateFile(file, batch);
      if (message !== null) {
        setFileError(batch ? `${file.name}：${message}` : message);
        return;
      }
    }
    if (batch && next.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_BYTES) {
      setFileError("文件总大小超过 48 MiB，请减少文件后重新选择。");
      return;
    }
    setSelection({ batch, files: next });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (uploading || files.length === 0 || knowledgeBaseId === "") {
      return;
    }

    setUploading(true);
    setUploadError(null);
    setNotice(null);
    try {
      if (batch) {
        const result = await uploadDocumentBatch(apiClient, files, knowledgeBaseId);
        setBatchItems(result.items);
        setNotice(`已提交 ${String(result.items.length)} 个文件，请在下方查看本批任务。`);
      } else {
        const result = await uploadDocument(apiClient, {
          file: files[0],
          knowledgeBaseId,
          title: title.trim() || undefined,
        });
        setNotice(
          `已提交「${result.document.title}」，导入任务 ${result.ingestion_task.id} 正在后台处理。`,
        );
        setTitle("");
        reloadTasks();
      }
      setSelection(null);
    } catch (caught) {
      setUploadError(caught instanceof ApiError ? caught.message : "上传失败，请稍后重试。");
    } finally {
      setUploading(false);
    }
  }

  async function handleRetry(taskId: string): Promise<void> {
    if (retrying) return;
    setRetrying(true);
    setActionError(null);
    try {
      await retryTask(apiClient, taskId);
      reloadTasks();
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "重试失败，请稍后重试。");
    } finally {
      setRetrying(false);
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
        <div className="page-head__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={switchMode}
            disabled={uploading}
          >
            {batch ? "单文件导入" : "批量导入"}
          </button>
          {presetKnowledgeBaseId !== "" ? (
            <Link className="btn btn--ghost" to={`/knowledge/${presetKnowledgeBaseId}`}>
              返回知识库
            </Link>
          ) : null}
        </div>
      </div>

      <section className={batch ? "card upload--batch" : "card"}>
        <div className="card__header">
          <h3 className="card__title">{batch ? "批量上传文件" : "上传文件"}</h3>
          <span className="faint">
            {batch ? "每批最多 20 个文件，合计不超过 48 MiB" : "单个文件上限 50 MB"}
          </span>
        </div>

        <div className="card__body">
          <form className="stack" onSubmit={(event) => void handleSubmit(event)}>
            <label className="field">
              <span className="field__label">归属知识库</span>
              <select
                className="field__input"
                value={knowledgeBaseId}
                onChange={(event) => setSelectedId(event.target.value)}
                disabled={uploading}
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
                <span className="upload__file">
                  {batch ? "选择多个文件" : (files[0]?.name ?? "点击选择文件")}
                </span>
                <span className="upload__hint" id="upload-file-hint">
                  支持 PDF、PNG、JPEG、TXT、Markdown 与 DOCX；扫描件会走 OCR 通道。
                </span>
                <input
                  id="upload-file"
                  className="sr-only"
                  type="file"
                  accept={ACCEPT_ATTR}
                  multiple={batch}
                  disabled={uploading}
                  aria-label={batch ? "选择多个文件" : "选择文件"}
                  aria-invalid={fileError !== null}
                  aria-describedby={
                    fileError ? "upload-file-hint upload-file-error" : "upload-file-hint"
                  }
                  onChange={(event) => {
                    pickFiles(Array.from(event.currentTarget.files ?? []));
                    event.currentTarget.value = "";
                  }}
                />
              </label>

              {batch && files.length > 0 ? (
                <ul className="upload__selection" aria-label="已选文件">
                  {files.map((file, index) => (
                    <li key={`${file.name}-${String(index)}`}>{file.name}</li>
                  ))}
                </ul>
              ) : null}
              {!batch && files[0] ? (
                <span className="faint">已选择 {(files[0].size / 1024).toFixed(0)} KB</span>
              ) : null}
            </div>

            {fileError ? (
              <p className="field__error" id="upload-file-error" role="alert">
                {fileError}
              </p>
            ) : null}

            {batch ? null : (
              <label className="field">
                <span className="field__label">标题（可选）</span>
                <input
                  className="field__input"
                  value={title}
                  maxLength={200}
                  disabled={uploading}
                  placeholder="留空时使用文件名"
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
            )}

            {uploadError ? (
              <p className="field__error" role="alert">
                {uploadError}
              </p>
            ) : null}

            {notice ? <output className="field__hint">{notice}</output> : null}

            <div className="row upload__actions">
              <button
                type="submit"
                className="btn"
                disabled={uploading || files.length === 0 || knowledgeBaseId === ""}
              >
                {uploading ? "上传中…" : batch ? "提交批量导入" : "提交导入"}
              </button>
              <span className="faint">提交后可在下方任务列表查看解析进度。</span>
            </div>
          </form>
        </div>
      </section>

      <section className="card">
        <div className="card__header">
          <h3 className="card__title">{currentBatch?.length ? "本批导入任务" : "导入任务"}</h3>
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

          {taskLoader.loading && (!currentBatch?.length || tasks.length === 0) ? (
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
                  {batchFiles.has(task.id) ? (
                    <h4 className="upload__task-name">{batchFiles.get(task.id)}</h4>
                  ) : null}
                  <TaskProgress task={task} />
                  {task.state === "failed" ? (
                    <div className="row mt-2">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={retrying || taskLoader.loading}
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
