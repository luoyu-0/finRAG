/**
 * 问答与溯源类型。
 *
 * 与 docs/api/系统接口.md §6 对应；后端字段由 app/schemas/qa.py 与
 * app/domain/rag.py 定义，此处保持一一对应。
 */

/**
 * 证据支持等级。
 *
 * 表示「当前检索证据对回答的支持程度」，**不是答案正确概率**。
 */
export type EvidenceLevel = "none" | "weak" | "moderate" | "strong";

/** 回答引用的来源，可定位到具体文档、页码或条文。 */
export interface Citation {
  /** 上下文中的证据标签，如 `S1`；与生成器返回的引用标签对应。 */
  label: string;
  /**
   * 该分块所属知识库。点击角标时用于跳转到知识库页面定位文档（契约 §6）。
   * 为兼容尚未返回该字段的实现，此处声明为可选。
   */
  knowledge_base_id?: string;
  document_id: string;
  version_id: string;
  chunk_id: string;
  title: string;
  page_number: number | null;
  article_number: string | null;
  source_url: string | null;
  /** 该分块中与引用相关的原文摘录；后端未提供时前端不展示引文段（契约 §6，可选）。 */
  excerpt?: string | null;
}

/** 证据支持度。 */
export interface EvidenceSupport {
  score: number;
  level: EvidenceLevel;
  method: string;
  explanation: string;
}

export interface QuestionRequest {
  question: string;
  /** 限定检索范围的知识库；为空表示不限。 */
  knowledge_base_ids?: string[];
  /** 判定制度有效性的目标时间（带时区 ISO 8601）；为空表示请求发生时间。 */
  effective_at?: string | null;
  /** 返回的证据条数，1–50，默认 8。 */
  top_k?: number;
}

export interface QuestionResponse {
  answer: string;
  citations: Citation[];
  evidence_support: EvidenceSupport;
  /** 降级或异常情况的可读提示。 */
  warnings: string[];
  trace_id: string;
}
