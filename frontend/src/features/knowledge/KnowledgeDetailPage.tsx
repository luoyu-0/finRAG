/**
 * 知识库详情页。
 *
 * 对应 docs/api/系统接口.md §7.2（详情）、§7.5（统计）、§8.2（文档列表）。
 */
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { getDocument, listDocumentCategories, listDocuments } from "../../api/documents";
import { getKnowledgeBase, getKnowledgeBaseStats } from "../../api/knowledge";
import { apiClient } from "../../api/session";
import { Badge } from "../../components/Badge";
import type { BadgeVariant } from "../../components/Badge";
import { PageState } from "../../components/PageState";
import { Pagination } from "../../components/Pagination";
import { useLoader } from "../../hooks/useLoader";
import type { Page } from "../../types/api";
import type {
  CategoryCount,
  DocumentDetail,
  DocumentFormat,
  DocumentSort,
  DocumentSortOrder,
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

/** 文档列表每页条数，与 §1.1 分页参数一起使用。 */
const PAGE_SIZE = 50;

/** 排序下拉选项，顺序即推荐顺序（§8.2）。 */
const SORT_LABEL: Record<DocumentSort, string> = {
  updated_at: "按更新时间",
  category: "按分类",
  title: "按标题",
  chunk_count: "按分块数",
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
  /** 从问答角标跳转时定位到的来源文档；不在文档列表第一页时也能单独取到。 */
  focused: DocumentDetail | null;
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
  // 文档列表按页取，避免 443 份文档只显示第一页。
  const [page, setPage] = useState(1);
  // 排序与筛选条件，改动任意一项都回到第一页。
  const [sort, setSort] = useState<DocumentSort>("updated_at");
  const [order, setOrder] = useState<DocumentSortOrder>("desc");
  const [category, setCategory] = useState("");
  const [format, setFormat] = useState<DocumentFormat | "">("");
  const [onlyWarning, setOnlyWarning] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [categories, setCategories] = useState<CategoryCount[]>([]);
  // 排序与筛选依赖 §8.2 参数和 §7.6 分类接口；未就绪时禁用控件并提示，避免看起来"点了没反应"。
  const [filterSupported, setFilterSupported] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    listDocumentCategories(apiClient, knowledgeBaseId)
      .then((items) => {
        if (alive) {
          setCategories(items);
          setFilterSupported(true);
        }
        return undefined;
      })
      .catch(() => {
        if (alive) {
          setFilterSupported(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [knowledgeBaseId]);

  const fetcher = useCallback(async (): Promise<DetailBundle> => {
    const [knowledgeBase, stats, documents, focused] = await Promise.all([
      getKnowledgeBase(apiClient, knowledgeBaseId),
      getKnowledgeBaseStats(apiClient, knowledgeBaseId),
      listDocuments(apiClient, {
        knowledge_base_id: knowledgeBaseId,
        page,
        page_size: PAGE_SIZE,
        sort,
        order,
        category: category === "" ? undefined : category,
        format: format === "" ? undefined : format,
        has_warning: onlyWarning ? true : undefined,
        q: appliedKeyword === "" ? undefined : appliedKeyword,
      }),
      // 被引文档可能不在第一页，单独取一次，保证「已定位到来源文档」始终有效。
      focusedDocId === null ? Promise.resolve(null) : getDocument(apiClient, focusedDocId),
    ]);
    return { knowledgeBase, stats, documents, focused };
  }, [
    knowledgeBaseId,
    focusedDocId,
    page,
    sort,
    order,
    category,
    format,
    onlyWarning,
    appliedKeyword,
  ]);

  const { data, error, loading, reload, beginLoad } = useLoader<DetailBundle>(fetcher);

  /** 任一查询条件变化都重新从第一页开始。 */
  const resetTo = useCallback(
    (apply: () => void) => {
      beginLoad();
      apply();
      setPage(1);
    },
    [beginLoad],
  );

  function handleSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    resetTo(() => setAppliedKeyword(keyword.trim()));
  }

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

  const { knowledgeBase, stats, documents, focused: focusedDocument } = data;
  const hasFilter = category !== "" || format !== "" || onlyWarning || appliedKeyword !== "";

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

      {focusedDocument === null ? null : (
        <section className="card">
          <div className="card__header">
            <h3 className="card__title">已定位到来源文档</h3>
            <Link
              className="btn btn--sm"
              to={`/documents/${encodeURIComponent(focusedDocument.id)}`}
            >
              阅读正文
            </Link>
          </div>
          <div className="card__body">
            <p className="table__title">{focusedDocument.title}</p>
            <p className="faint">
              {focusedDocument.file_name} · {formatDate(focusedDocument.updated_at)}
            </p>
          </div>
        </section>
      )}

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
          </span>{" "}
        </div>

        <div className="card__toolbar">
          {filterSupported === false ? (
            <p className="faint">
              后端尚未提供文档排序与筛选接口（契约 §8.2、§7.6），以下控件暂不可用。
            </p>
          ) : null}
          <form className="toolbar" onSubmit={handleSearch}>
            <fieldset className="toolbar__group" disabled={filterSupported === false}>
              <label className="sr-only" htmlFor="doc-sort">
                排序方式
              </label>
              <select
                id="doc-sort"
                className="field__input toolbar__select"
                value={sort}
                onChange={(event) => {
                  const next = event.target.value as DocumentSort;
                  resetTo(() => setSort(next));
                }}
              >
                {(Object.keys(SORT_LABEL) as DocumentSort[]).map((key) => (
                  <option key={key} value={key}>
                    {SORT_LABEL[key]}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className="btn btn--ghost btn--sm"
                aria-label={order === "asc" ? "切换为降序" : "切换为升序"}
                onClick={() => resetTo(() => setOrder(order === "asc" ? "desc" : "asc"))}
              >
                {order === "asc" ? "↑ 升序" : "↓ 降序"}
              </button>

              <label className="sr-only" htmlFor="doc-category">
                按分类筛选
              </label>
              <select
                id="doc-category"
                className="field__input toolbar__select"
                value={category}
                onChange={(event) => {
                  const next = event.target.value;
                  resetTo(() => setCategory(next));
                }}
              >
                <option value="">全部分类</option>
                {categories.map((item) => (
                  <option key={item.category} value={item.category}>
                    {item.category}（{item.document_count}）
                  </option>
                ))}
              </select>

              <label className="sr-only" htmlFor="doc-format">
                按格式筛选
              </label>
              <select
                id="doc-format"
                className="field__input toolbar__select"
                value={format}
                onChange={(event) => {
                  const next = event.target.value as DocumentFormat | "";
                  resetTo(() => setFormat(next));
                }}
              >
                <option value="">全部格式</option>
                <option value="txt">TXT 文本</option>
                <option value="pdf">PDF 文档</option>
              </select>

              <label className="row">
                <input
                  type="checkbox"
                  checked={onlyWarning}
                  onChange={(event) => {
                    const next = event.target.checked;
                    resetTo(() => setOnlyWarning(next));
                  }}
                />
                <span className="faint">只看有解析告警</span>
              </label>

              <label className="sr-only" htmlFor="doc-keyword">
                按标题搜索文档
              </label>
              <input
                id="doc-keyword"
                className="field__input toolbar__input"
                placeholder="按标题搜索"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
              />
              <button type="submit" className="btn btn--ghost btn--sm">
                搜索
              </button>
            </fieldset>
          </form>
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
          ) : hasFilter ? (
            <PageState
              title="没有匹配的文档"
              description="换一个分类、格式或关键词，或清空筛选后重试。"
              actions={
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    resetTo(() => {
                      setCategory("");
                      setFormat("");
                      setOnlyWarning(false);
                      setKeyword("");
                      setAppliedKeyword("");
                    })
                  }
                >
                  清空筛选
                </button>
              }
            />
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
          {documents.items.length > 0 ? (
            <Pagination
              page={documents.page}
              pageSize={documents.page_size}
              total={documents.total}
              hasNext={documents.has_next}
              onChange={(next) => {
                beginLoad();
                setPage(next);
              }}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}
