/**
 * 知识库、文档、导入任务、历史与收藏的演示数据。
 *
 * 仅在 `MOCK_ENABLED` 为真时使用（单元测试，或 `VITE_DEMO=1` 的开发预览）。
 *
 * 注意：此处的制度标题、条文编号、文件大小与时间**均为虚构示例**，
 * 只用于展示界面结构与交互，不代表任何真实监管规定。
 *
 * 数据保存在模块级变量中，因此创建、上传、删除、收藏等操作在演示模式下
 * 会产生可见的状态变化，便于演示完整交互。
 */
import type { Page, PageQuery } from "../types/api";
import type { FavoriteRecord, QaRecord } from "../types/history";
import type {
  DocumentSummary,
  IngestionTask,
  KnowledgeBase,
  KnowledgeBaseStats,
} from "../types/knowledge";

const LATENCY_MS = 320;

function simulate<T>(value: T, ms = LATENCY_MS): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
  });
}

/** 把数组切片为契约 §1.1 的分页包装。 */
export function paginate<T>(items: T[], query: PageQuery): Page<T> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.page_size ?? 20));
  const start = (page - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);

  return {
    items: slice,
    page,
    page_size: pageSize,
    total: items.length,
    has_next: start + slice.length < items.length,
  };
}

let knowledgeBases: KnowledgeBase[] = [
  {
    id: "kb_001",
    name: "金融监管制度库",
    description: "面向银行监管政策、支付业务与反洗钱的公开制度材料。",
    document_count: 5,
    chunk_count: 1840,
    created_at: "2026-10-01T02:00:00Z",
    updated_at: "2026-10-26T08:30:00Z",
  },
  {
    id: "kb_002",
    name: "支付与征信专题库",
    description: "支付机构监管、征信业务与受益所有人识别的专题集合。",
    document_count: 3,
    chunk_count: 620,
    created_at: "2026-10-20T06:15:00Z",
    updated_at: "2026-10-25T11:05:00Z",
  },
];

let documents: DocumentSummary[] = [
  {
    id: "doc_001",
    knowledge_base_id: "kb_001",
    title: "商业银行流动性风险管理办法（示例）",
    file_name: "流动性风险管理办法.pdf",
    file_size: 2_456_789,
    page_count: 32,
    source_url: null,
    tags: ["流动性风险", "商业银行"],
    version_count: 2,
    current_version: {
      id: "ver_001b",
      policy_status: "active",
      effective_from: "2026-07-01T00:00:00Z",
      effective_to: null,
    },
    created_at: "2026-10-10T02:00:00Z",
    updated_at: "2026-10-26T08:30:00Z",
  },
  {
    id: "doc_002",
    knowledge_base_id: "kb_001",
    title: "中华人民共和国反洗钱法（示例）",
    file_name: "反洗钱法.pdf",
    file_size: 1_180_240,
    page_count: 18,
    source_url: null,
    tags: ["反洗钱"],
    version_count: 1,
    current_version: {
      id: "ver_002a",
      policy_status: "active",
      effective_from: "2026-01-01T00:00:00Z",
      effective_to: null,
    },
    created_at: "2026-10-12T03:20:00Z",
    updated_at: "2026-10-24T07:10:00Z",
  },
  {
    id: "doc_003",
    knowledge_base_id: "kb_001",
    title: "中国人民银行残缺污损人民币兑换办法（示例）",
    file_name: "兑换办法扫描件.pdf",
    file_size: 5_820_416,
    page_count: 6,
    source_url: null,
    tags: ["人民币", "扫描件"],
    version_count: 1,
    current_version: {
      id: "ver_003a",
      policy_status: "inactive",
      effective_from: "2018-01-01T00:00:00Z",
      effective_to: "2025-12-31T00:00:00Z",
    },
    created_at: "2026-10-15T09:00:00Z",
    updated_at: "2026-10-15T09:40:00Z",
  },
  {
    id: "doc_004",
    knowledge_base_id: "kb_001",
    title: "系统重要性银行附加监管规定（示例）",
    file_name: "附加监管规定.docx",
    file_size: 98_304,
    page_count: 12,
    source_url: null,
    tags: ["系统重要性银行"],
    version_count: 1,
    current_version: {
      id: "ver_004a",
      policy_status: "active",
      effective_from: "2026-05-01T00:00:00Z",
      effective_to: null,
    },
    created_at: "2026-10-18T02:30:00Z",
    updated_at: "2026-10-22T05:00:00Z",
  },
  {
    id: "doc_005",
    knowledge_base_id: "kb_001",
    title: "征信业管理条例（示例）",
    file_name: "征信业管理条例.pdf",
    file_size: 764_512,
    page_count: 9,
    source_url: null,
    tags: ["征信"],
    version_count: 1,
    current_version: null,
    created_at: "2026-10-19T04:00:00Z",
    updated_at: "2026-10-19T04:20:00Z",
  },
  {
    id: "doc_006",
    knowledge_base_id: "kb_002",
    title: "非银行支付机构监督管理条例（示例）",
    file_name: "非银行支付机构条例.pdf",
    file_size: 3_204_096,
    page_count: 24,
    source_url: null,
    tags: ["支付机构", "监管条例"],
    version_count: 1,
    current_version: {
      id: "ver_006a",
      policy_status: "active",
      effective_from: "2026-05-01T00:00:00Z",
      effective_to: null,
    },
    created_at: "2026-10-20T06:30:00Z",
    updated_at: "2026-10-25T11:05:00Z",
  },
];

let tasks: IngestionTask[] = [
  {
    id: "task_001",
    document_id: "doc_001",
    version_id: "ver_001b",
    state: "succeeded",
    stage: "completed",
    progress: 1,
    page_total: 32,
    page_processed: 32,
    attempt: 1,
    queued_at: "2026-10-26T08:20:00Z",
    started_at: "2026-10-26T08:20:04Z",
    finished_at: "2026-10-26T08:30:00Z",
    warnings: [],
    error: null,
    created_by: "user_admin",
  },
  {
    id: "task_002",
    document_id: "doc_006",
    version_id: null,
    state: "processing",
    stage: "ocr",
    progress: 0.45,
    page_total: 24,
    page_processed: 11,
    attempt: 1,
    queued_at: "2026-10-27T01:10:00Z",
    started_at: "2026-10-27T01:10:06Z",
    finished_at: null,
    warnings: ["第 3 页 OCR 置信度较低，已回落为原生文本提取"],
    error: null,
    created_by: "user_admin",
  },
  {
    id: "task_003",
    document_id: "doc_003",
    version_id: null,
    state: "failed",
    stage: "extracting",
    progress: 0.12,
    page_total: 6,
    page_processed: 1,
    attempt: 2,
    queued_at: "2026-10-25T02:00:00Z",
    started_at: "2026-10-25T02:00:03Z",
    finished_at: "2026-10-25T02:01:12Z",
    warnings: [],
    error: {
      error_code: "OCR_ENGINE_UNAVAILABLE",
      message: "OCR 引擎不可用，请检查 PaddleOCR 服务或稍后重试。",
    },
    created_by: "user_admin",
  },
];

let history: QaRecord[] = [
  {
    id: "qa_001",
    question: "商业银行应如何管理流动性风险？",
    answer:
      "根据检索到的示例条文，流动性风险管理通常包含治理与策略、限额与监测、压力测试与应急预案三个层面[S1][S2]。以上内容由演示数据生成。",
    citations: [
      {
        label: "S1",
        document_id: "doc_001",
        version_id: "ver_001b",
        chunk_id: "chunk_001",
        title: "商业银行流动性风险管理办法（示例）",
        page_number: 12,
        article_number: "第二十条",
        source_url: null,
        excerpt:
          "商业银行应当建立与本行规模、业务复杂程度相适应的流动性风险管理体系，并明确董事会与高级管理层在流动性风险管理中的职责。",
      },
      {
        label: "S2",
        document_id: "doc_001",
        version_id: "ver_001b",
        chunk_id: "chunk_042",
        title: "商业银行流动性风险管理办法（示例）",
        page_number: 18,
        article_number: "第三十四条",
        source_url: null,
        excerpt:
          "商业银行应当持续监测现金流缺口、流动性覆盖率等流动性风险指标，并对突破预警限额的情况及时报告。",
      },
    ],
    evidence_support: {
      score: 0.82,
      level: "strong",
      method: "retrieval_evidence_v1",
      explanation: "表示当前检索证据对回答的支持程度，不是答案正确概率。",
    },
    warnings: [],
    trace_id: "trace_demo_001",
    knowledge_base_ids: ["kb_001"],
    effective_at: "2026-10-26T00:00:00Z",
    favorite_id: "fav_001",
    favorited: true,
    created_at: "2026-10-26T09:12:00Z",
  },
  {
    id: "qa_002",
    question: "支付业务许可证期满后最迟何时提出续展申请？",
    answer:
      "根据示例条文，应当在许可证期满前 6 个月内向所在地中国人民银行分支机构提出续展申请[S1]。",
    citations: [
      {
        label: "S1",
        document_id: "doc_006",
        version_id: "ver_006a",
        chunk_id: "chunk_311",
        title: "非银行支付机构监督管理条例（示例）",
        page_number: 4,
        article_number: "第十条",
        source_url: null,
        excerpt:
          "支付机构拟在支付业务许可证期满后继续从事支付业务的，应当在期满前 6 个月内向所在地中国人民银行分支机构提出续展申请。",
      },
    ],
    evidence_support: {
      score: 0.74,
      level: "moderate",
      method: "retrieval_evidence_v1",
      explanation: "表示当前检索证据对回答的支持程度，不是答案正确概率。",
    },
    warnings: [],
    trace_id: "trace_demo_002",
    knowledge_base_ids: ["kb_002"],
    effective_at: null,
    favorite_id: null,
    favorited: false,
    created_at: "2026-10-25T07:40:00Z",
  },
  {
    id: "qa_003",
    question: "残缺污损人民币的兑换标准是什么？",
    answer: "未在当前有效制度中检索到足够依据，暂无法回答该问题。",
    citations: [],
    evidence_support: {
      score: 0,
      level: "none",
      method: "retrieval_evidence_v1",
      explanation: "未检索到可用于回答的有效证据；该分数不是答案正确概率。",
    },
    warnings: ["目标知识库中该制度的有效版本为空，检索已过滤全部失效版本。"],
    trace_id: "trace_demo_003",
    knowledge_base_ids: ["kb_001"],
    effective_at: "2026-10-26T00:00:00Z",
    favorite_id: null,
    favorited: false,
    created_at: "2026-10-24T03:05:00Z",
  },
];

let favorites: FavoriteRecord[] = [
  {
    id: "fav_001",
    qa_id: "qa_001",
    question: "商业银行应如何管理流动性风险？",
    answer_excerpt:
      "根据检索到的示例条文，流动性风险管理通常包含治理与策略、限额与监测、压力测试与应急预案三个层面…",
    evidence_support: { score: 0.82, level: "strong" },
    citation_count: 2,
    created_at: "2026-10-26T09:15:00Z",
  },
];

/* ── 知识库 ─────────────────────────────────────────────── */

export function demoListKnowledgeBases(
  query: PageQuery & { q?: string },
): Promise<Page<KnowledgeBase>> {
  const keyword = query.q?.trim().toLowerCase();
  const filtered = keyword
    ? knowledgeBases.filter(
        (item) =>
          item.name.toLowerCase().includes(keyword) ||
          (item.description ?? "").toLowerCase().includes(keyword),
      )
    : knowledgeBases;
  return simulate(paginate(filtered, query));
}

export function demoGetKnowledgeBase(id: string): Promise<KnowledgeBase> {
  const found = knowledgeBases.find((item) => item.id === id);
  if (!found) {
    return Promise.reject(new Error("KNOWLEDGE_BASE_NOT_FOUND"));
  }
  return simulate({ ...found });
}

export function demoCreateKnowledgeBase(payload: {
  name: string;
  description?: string;
}): Promise<KnowledgeBase> {
  const created: KnowledgeBase = {
    id: `kb_${String(knowledgeBases.length + 1).padStart(3, "0")}`,
    name: payload.name,
    description: payload.description ?? null,
    document_count: 0,
    chunk_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  knowledgeBases = [created, ...knowledgeBases];
  return simulate(created);
}

export function demoGetKnowledgeBaseStats(id: string): Promise<KnowledgeBaseStats> {
  const docs = documents.filter((item) => item.knowledge_base_id === id);
  const active = docs.filter((item) => item.current_version?.policy_status === "active").length;
  const chunkCount = docs.reduce((sum, item) => sum + item.page_count * 12, 0);
  return simulate({
    knowledge_base_id: id,
    document_count: docs.length,
    version_count: docs.reduce((sum, item) => sum + item.version_count, 0),
    chunk_count: chunkCount,
    active_version_count: active,
    inactive_version_count: docs.length - active,
    embedded_chunk_count: Math.round(chunkCount * 0.95),
    pending_chunk_count: Math.round(chunkCount * 0.05),
    parse_warning_count: 3,
    last_ingested_at: "2026-10-26T08:30:00Z",
  });
}

/* ── 文档 ───────────────────────────────────────────────── */

export function demoListDocuments(
  query: PageQuery & { knowledge_base_id?: string; policy_status?: string; q?: string },
): Promise<Page<DocumentSummary>> {
  let filtered = documents;
  if (query.knowledge_base_id) {
    filtered = filtered.filter((item) => item.knowledge_base_id === query.knowledge_base_id);
  }
  if (query.policy_status) {
    filtered = filtered.filter(
      (item) => item.current_version?.policy_status === query.policy_status,
    );
  }
  if (query.q?.trim()) {
    const keyword = query.q.trim().toLowerCase();
    filtered = filtered.filter((item) => item.title.toLowerCase().includes(keyword));
  }
  return simulate(paginate(filtered, query));
}

export function demoDeleteDocument(id: string): Promise<void> {
  documents = documents.filter((item) => item.id !== id);
  return simulate(undefined);
}

export function demoUploadDocument(payload: {
  fileName: string;
  fileSize: number;
  knowledgeBaseId: string;
  title?: string;
}): Promise<{ document: DocumentSummary; task: IngestionTask }> {
  const seq = documents.length + 1;
  const document: DocumentSummary = {
    id: `doc_${String(seq).padStart(3, "0")}`,
    knowledge_base_id: payload.knowledgeBaseId,
    title: payload.title?.trim() ? payload.title.trim() : payload.fileName,
    file_name: payload.fileName,
    file_size: payload.fileSize,
    page_count: Math.max(1, Math.round(payload.fileSize / 120_000)),
    source_url: null,
    tags: [],
    version_count: 0,
    current_version: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const task: IngestionTask = {
    id: `task_${String(tasks.length + 1).padStart(3, "0")}`,
    document_id: document.id,
    version_id: null,
    state: "processing",
    stage: "extracting",
    progress: 0.08,
    page_total: document.page_count,
    page_processed: 0,
    attempt: 1,
    queued_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    finished_at: null,
    warnings: [],
    error: null,
    created_by: "user_admin",
  };
  documents = [document, ...documents];
  tasks = [task, ...tasks];
  return simulate({ document, task });
}

/* ── 导入任务 ───────────────────────────────────────────── */

export function demoListTasks(
  query: PageQuery & { state?: string; document_id?: string },
): Promise<Page<IngestionTask>> {
  let filtered = tasks;
  if (query.state) {
    filtered = filtered.filter((item) => item.state === query.state);
  }
  if (query.document_id) {
    filtered = filtered.filter((item) => item.document_id === query.document_id);
  }
  return simulate(paginate(filtered, query));
}

export function demoRetryTask(id: string): Promise<IngestionTask> {
  tasks = tasks.map((item) =>
    item.id === id
      ? {
          ...item,
          state: "queued" as const,
          stage: "received" as const,
          progress: 0,
          attempt: item.attempt + 1,
          error: null,
        }
      : item,
  );
  const found = tasks.find((item) => item.id === id);
  return found ? simulate(found) : Promise.reject(new Error("INGESTION_TASK_NOT_FOUND"));
}

/* ── 问答历史 ───────────────────────────────────────────── */

export function demoListHistory(
  query: PageQuery & { q?: string; favorited?: boolean },
): Promise<Page<QaRecord>> {
  let filtered = history;
  if (query.favorited !== undefined) {
    filtered = filtered.filter((item) => item.favorited === query.favorited);
  }
  if (query.q?.trim()) {
    const keyword = query.q.trim().toLowerCase();
    filtered = filtered.filter((item) => item.question.toLowerCase().includes(keyword));
  }
  return simulate(paginate(filtered, query));
}

export function demoDeleteHistory(id: string): Promise<void> {
  history = history.filter((item) => item.id !== id);
  favorites = favorites.filter((item) => item.qa_id !== id);
  return simulate(undefined);
}

/* ── 收藏 ───────────────────────────────────────────────── */

export function demoListFavorites(query: PageQuery): Promise<Page<FavoriteRecord>> {
  return simulate(paginate(favorites, query));
}

export function demoAddFavorite(qaId: string): Promise<FavoriteRecord> {
  const record = history.find((item) => item.id === qaId);
  if (!record) {
    return Promise.reject(new Error("QA_RECORD_NOT_FOUND"));
  }
  const created: FavoriteRecord = {
    id: `fav_${String(favorites.length + 1).padStart(3, "0")}`,
    qa_id: record.id,
    question: record.question,
    answer_excerpt: `${record.answer.slice(0, 60)}…`,
    evidence_support: {
      score: record.evidence_support.score,
      level: record.evidence_support.level,
    },
    citation_count: record.citations.length,
    created_at: new Date().toISOString(),
  };
  history = history.map((item) =>
    item.id === qaId ? { ...item, favorite_id: created.id, favorited: true } : item,
  );
  favorites = [created, ...favorites];
  return simulate(created);
}

export function demoRemoveFavorite(id: string): Promise<void> {
  const target = favorites.find((item) => item.id === id);
  favorites = favorites.filter((item) => item.id !== id);
  if (target) {
    history = history.map((item) =>
      item.id === target.qa_id ? { ...item, favorite_id: null, favorited: false } : item,
    );
  }
  return simulate(undefined);
}
