/**
 * 知识库与文档类型。
 *
 * 与 docs/api/系统接口.md 对应：§7 知识库接口、§8 文档与导入任务接口。
 */

/** 制度版本时效状态。 */
export type PolicyStatus = "active" | "inactive" | "unknown";

/** 取得正文的途径。 */
export type ParseMethod = "native" | "ocr";

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  document_count: number;
  chunk_count: number;
  created_at: string;
  updated_at: string;
}

/** 知识库导入健康度，对应 §7.5。 */
export interface KnowledgeBaseStats {
  knowledge_base_id: string;
  document_count: number;
  version_count: number;
  chunk_count: number;
  active_version_count: number;
  inactive_version_count: number;
  embedded_chunk_count: number;
  pending_chunk_count: number;
  parse_warning_count: number;
  last_ingested_at: string | null;
}

/** 文档摘要中的当前有效版本。 */
export interface DocumentVersionRef {
  id: string;
  policy_status: PolicyStatus;
  effective_from: string | null;
  effective_to: string | null;
}

export interface DocumentVersion extends DocumentVersionRef {
  chunk_count: number;
  parse_method: ParseMethod;
  parse_warning_count: number;
  created_at: string;
}

/** 文档摘要，对应 §8.2。 */
export interface DocumentSummary {
  id: string;
  knowledge_base_id: string;
  title: string;
  file_name: string;
  file_size: number;
  page_count: number;
  source_url: string | null;
  tags: string[];
  version_count: number;
  current_version: DocumentVersionRef | null;
  created_at: string;
  updated_at: string;
}

/** 文档详情，对应 §8.3。 */
export interface DocumentDetail extends DocumentSummary {
  versions: DocumentVersion[];
}

/** 导入任务状态机，对应 §8.6。 */
export type IngestionState = "queued" | "processing" | "succeeded" | "failed" | "cancelled";

export type IngestionStage =
  | "received"
  | "extracting"
  | "ocr"
  | "normalizing"
  | "chunking"
  | "embedding"
  | "indexing"
  | "completed";

export interface IngestionTaskError {
  error_code: string;
  message: string;
}

export interface IngestionTask {
  id: string;
  document_id: string;
  version_id: string | null;
  state: IngestionState;
  stage: IngestionStage;
  /** 0–1 的进度。 */
  progress: number;
  page_total: number;
  page_processed: number;
  attempt: number;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  warnings: string[];
  error: IngestionTaskError | null;
  created_by: string;
}

/** §8.1 上传成功后的返回。 */
export interface UploadDocumentResponse {
  document: DocumentSummary;
  ingestion_task: IngestionTask;
}

/** §8.1 允许上传的文件类型。 */
export const ACCEPTED_UPLOAD_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

/** 上传大小上限（字节），与 Nginx client_max_body_size 保持一致。 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
