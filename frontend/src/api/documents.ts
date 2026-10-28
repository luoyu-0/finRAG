/** 文档与导入任务接口封装，对应 docs/api/系统接口.md §8。 */
import type { ApiClient } from "./client";
import { MOCK_ENABLED } from "./mode";
import type { Page, PageQuery } from "../types/api";
import type {
  DocumentDetail,
  DocumentSummary,
  IngestionTask,
  PolicyStatus,
  UploadDocumentResponse,
} from "../types/knowledge";

export interface ListDocumentsQuery extends PageQuery {
  knowledge_base_id?: string;
  policy_status?: PolicyStatus;
  q?: string;
}

export interface ListTasksQuery extends PageQuery {
  state?: string;
  document_id?: string;
}

export interface UploadDocumentInput {
  file: File;
  knowledgeBaseId: string;
  title?: string;
}

export async function listDocuments(
  client: ApiClient,
  query: ListDocumentsQuery = {},
): Promise<Page<DocumentSummary>> {
  if (MOCK_ENABLED) {
    const { demoListDocuments } = await import("./demo");
    return demoListDocuments(query);
  }
  return client.get<Page<DocumentSummary>>("/documents", {
    query: {
      page: query.page,
      page_size: query.page_size,
      knowledge_base_id: query.knowledge_base_id,
      policy_status: query.policy_status,
      q: query.q,
    },
  });
}

export async function getDocument(client: ApiClient, documentId: string): Promise<DocumentDetail> {
  return client.get<DocumentDetail>(`/documents/${documentId}`);
}

export async function deleteDocument(client: ApiClient, documentId: string): Promise<void> {
  if (MOCK_ENABLED) {
    const { demoDeleteDocument } = await import("./demo");
    return demoDeleteDocument(documentId);
  }
  await client.delete<void>(`/documents/${documentId}`);
}

/**
 * 上传文档。
 *
 * 契约 §8.1 返回 `202`：上传只负责落盘与建任务，解析与索引异步进行，
 * 因此页面应轮询 {@link listTasks} 获取进度，而不是等待本请求完成解析。
 */
export async function uploadDocument(
  client: ApiClient,
  input: UploadDocumentInput,
): Promise<UploadDocumentResponse> {
  if (MOCK_ENABLED) {
    const { demoUploadDocument } = await import("./demo");
    const created = await demoUploadDocument({
      fileName: input.file.name,
      fileSize: input.file.size,
      knowledgeBaseId: input.knowledgeBaseId,
      title: input.title,
    });
    return { document: created.document, ingestion_task: created.task };
  }

  const form = new FormData();
  form.append("file", input.file);
  form.append("knowledge_base_id", input.knowledgeBaseId);
  if (input.title) {
    form.append("title", input.title);
  }
  return client.postForm<UploadDocumentResponse>("/documents", form);
}

export async function listTasks(
  client: ApiClient,
  query: ListTasksQuery = {},
): Promise<Page<IngestionTask>> {
  if (MOCK_ENABLED) {
    const { demoListTasks } = await import("./demo");
    return demoListTasks(query);
  }
  return client.get<Page<IngestionTask>>("/ingestion-tasks", {
    query: {
      page: query.page,
      page_size: query.page_size,
      state: query.state,
      document_id: query.document_id,
    },
  });
}

export async function retryTask(client: ApiClient, taskId: string): Promise<IngestionTask> {
  if (MOCK_ENABLED) {
    const { demoRetryTask } = await import("./demo");
    return demoRetryTask(taskId);
  }
  return client.post<IngestionTask>(`/ingestion-tasks/${taskId}/retry`);
}
