/**
 * 知识库详情页。
 *
 * 对应 docs/api/系统接口.md §7.2（详情）、§7.5（统计）、§8.2（文档列表）。
 */
import { useCallback } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { listDocuments } from "../../api/documents";
import { getKnowledgeBase, getKnowledgeBaseStats } from "../../api/knowledge";
import { apiClient } from "../../api/session";
import { Badge } from "../../components/Badge";
import type { BadgeVariant } from "../../components/Badge";
import { PageState } from "../../components/PageState";
import { useLoader } from "../../hooks/useLoader";
import type { Page } from "../../types/api";
import type {
  DocumentSummary,
  KnowledgeBase,
  KnowledgeBaseStats,
  PolicyStatus,
} from "../../types/knowledge";

const POLICY_LABEL: Record<PolicyStatus, string> = {
  active: "有效",
  inactive: "已失效",
  unknown: "未知",
};

const POLICY_VARIANT: Record<PolicyStatus, BadgeVariant> = {
  active: "success",
  inactive: "danger",
  unknown: "neutral",
};

interface DetailBundle {
  knowledgeBase: KnowledgeBase;
  stats: KnowledgeBaseStats;
  documents: Page<DocumentSummary>;
}

function formatDate(value: string | null): string {
  if (value === null) {
    return "—";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

export function KnowledgeDetailPage() {
  const { knowledgeBaseId = "" } = useParams();
  // 从问答页的引用角标跳转过来时，URL 带 `?doc=<document_id>`，据此高亮该文档。
  const [searchParams] = useSearchParams();
  const focusedDocId = searchParams.get("doc");

  const fetcher = useCallback(async (): Promise<DetailBundle> => {
    const [knowledgeBase, stats, documents] = await Promise.all([
      getKnowledgeBase(apiClient, knowledgeBaseId),
      getKnowledgeBaseStats(apiClient, knowledgeBaseId),
      listDocuments(apiClient, { knowledge_base_id: knowledgeBaseId, page_size: 50 }),
    ]);
    return { knowledgeBase, stats, documents };
  }, [knowledgeBaseId]);

  const { data, error, loading, reload } = useLoader<DetailBundle>(fetcher);

  if (loading) {
    return <PageState kind="loading" title="正在加载知识库…" />;
  }

  if (error) {
    return (
      <PageState
        kind="error"
        title="加载知识库失败"
        description={error.message}
        errorCode={error.code}
        actions={
          <>
            <button type="button" className="btn" onClick={reload}>
              重试
            </button>
            <Link className="btn btn--ghost" to="/knowledge">
              返回列表
            </Link>
          </>
        }
      />
    );
  }

  if (data === null) {
    return <PageState title="知识库不存在" description="该知识库可能已被删除。" />;
  }

  const { knowledgeBase, stats, documents } = data;
  const focusedDocument =
    focusedDocId === null ? null : (documents.items.find((doc) => doc.id === focusedDocId) ?? null);

  return (
    <div className="stack stack--section">
      <div className="page-head">
        <div>
          <h2 className="page-head__title">{knowledgeBase.name}</h2>
          <p className="page-head__desc">{knowledgeBase.description ?? "该知识库暂无描述。"}</p>
        </div>

        <div className="page-head__actions">
          <Link className="btn btn--ghost" to="/knowledge">
            返回列表
          </Link>
          <Link className="btn" to={`/import?kb=${knowledgeBaseId}`}>
            导入文档
          </Link>
        </div>
      </div>

      <section className="card">
        <div className="card__header">
          <h3 className="card__title">导入健康度</h3>
          <span className="faint">最近导入：{formatDate(stats.last_ingested_at)}</span>
        </div>
        <div className="card__body">
          <div className="stat-grid">
            <div className="stat">
              <div className="stat__label">文档数</div>
              <div className="stat__value">{stats.document_count}</div>
            </div>
            <div className="stat">
              <div className="stat__label">制度版本数</div>
              <div className="stat__value">{stats.version_count}</div>
            </div>
            <div className="stat">
              <div className="stat__label">分块数</div>
              <div className="stat__value">{stats.chunk_count}</div>
              <div className="stat__hint">已向量化 {stats.embedded_chunk_count}</div>
            </div>
            <div className="stat">
              <div className="stat__label">有效版本</div>
              <div className="stat__value">{stats.active_version_count}</div>
              <div className="stat__hint">失效 {stats.inactive_version_count}</div>
            </div>
            <div className="stat">
              <div className="stat__label">待向量化</div>
              <div className="stat__value">{stats.pending_chunk_count}</div>
            </div>
            <div className="stat">
              <div className="stat__label">解析告警</div>
              <div className="stat__value">{stats.parse_warning_count}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card__header">
          <h3 className="card__title">文档</h3>
          <span className="faint">
            {focusedDocument === null
              ? `共 ${String(documents.total)} 份`
              : `已定位到来源文档：${focusedDocument.title}`}
          </span>
        </div>

        <div className="card__body card__body--flush">
          {documents.items.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">制度文档</th>
                    <th scope="col">时效状态</th>
                    <th scope="col">页数</th>
                    <th scope="col">大小</th>
                    <th scope="col">版本</th>
                    <th scope="col">更新时间</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.items.map((doc) => {
                    const status = doc.current_version?.policy_status ?? "unknown";
                    return (
                      <tr
                        key={doc.id}
                        className={doc.id === focusedDocId ? "table__row--focus" : undefined}
                      >
                        <td>
                          <div className="table__title">{doc.title}</div>
                          <div className="table__sub">{doc.file_name}</div>
                          {doc.tags.length > 0 ? (
                            <div className="tag-list">
                              {doc.tags.map((tag) => (
                                <span className="tag" key={tag}>
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <Badge variant={POLICY_VARIANT[status]}>{POLICY_LABEL[status]}</Badge>
                        </td>
                        <td className="table__numeric">{doc.page_count}</td>
                        <td className="table__numeric">{formatSize(doc.file_size)}</td>
                        <td className="table__numeric">{doc.version_count}</td>
                        <td className="table__numeric">{formatDate(doc.updated_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <PageState
              title="该知识库还没有文档"
              description="导入制度文档后，系统会在后台完成解析、条文切分与向量化。"
              actions={
                <Link className="btn" to={`/import?kb=${knowledgeBaseId}`}>
                  导入文档
                </Link>
              }
            />
          )}
        </div>
      </section>
    </div>
  );
}
