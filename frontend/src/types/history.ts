/**
 * 问答历史与收藏类型。
 *
 * 与 docs/api/系统接口.md §9 对应。
 */
import type { Citation, EvidenceSupport } from "./qa";

/** 问答记录；列表项与详情字段一致（契约 §9.1）。 */
export interface QaRecord {
  id: string;
  question: string;
  answer: string;
  citations: Citation[];
  evidence_support: EvidenceSupport;
  warnings: string[];
  trace_id: string;
  knowledge_base_ids: string[];
  effective_at: string | null;
  /** 当前用户对该记录的收藏 ID；未收藏时为 null（契约 §9.1）。 */
  favorite_id: string | null;
  favorited: boolean;
  created_at: string;
}

/** 收藏记录；只保存摘要，不复制全文（契约 §9.4）。 */
export interface FavoriteRecord {
  id: string;
  qa_id: string;
  question: string;
  answer_excerpt: string;
  evidence_support: Pick<EvidenceSupport, "score" | "level">;
  citation_count: number;
  created_at: string;
}

export interface AddFavoriteRequest {
  qa_id: string;
}
