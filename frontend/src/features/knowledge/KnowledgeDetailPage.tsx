/**
 * 知识库详情页。
 *
 * 对应 docs/api/系统接口.md §7.2（详情）、§7.4（更新）、§7.5（统计）、§8.2（文档列表）。
 *
 * 交互约定：
 * - 列表页码与筛选条件写入 URL（`page`/`sort`/`order`/`category`/`format`/`warning`/`q`），
 *   进入文档正文后「返回知识库」可回到原来的页码与筛选位置。
 * - 头部、统计与文档表拆成独立的 memo 组件，并只用各自的加载状态：换页、编辑等操作
 *   只更新对应区域，不再整页闪成加载态。
 */
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { getDocument, listDocumentCategories, listDocuments } from "../../api/documents";
import { ApiError } from "../../api/errors";
import { getKnowledgeBase, getKnowledgeBaseStats, updateKnowledgeBase } from "../../api/knowledge";
import { apiClient } from "../../api/session";
import { Badge } from "../../components/Badge";
import type { BadgeVariant } from "../../components/Badge";
import { Breadcrumb } from "../../components/Breadcrumb";
import { PageState } from "../../components/PageState";
import { Pagination } from "../../components/Pagination";
import { useLoader } from "../../hooks/useLoader";
import { useAuth } from "../../stores/auth";
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

/** 写进 URL 的列表条件；`doc` 是来源定位参数，单独保留。 */
const LIST_KEYS = ["page", "sort", "order", "category", "format", "warning", "q"] as const;

interface ListParams {
  page: number;
  sort: DocumentSort;
  order: DocumentSortOrder;
  category: string;
  format: DocumentFormat | "";
  warning: boolean;
  q: string;
}

function readListParams(searchParams: URLSearchParams): ListParams {
  const rawPage = Number.parseInt(searchParams.get("page") ?? "", 10);
  const rawSort = searchParams.get("sort");
  const rawOrder = searchParams.get("order");
  const rawFormat = searchParams.get("format");
  return {
    page: Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1,
    sort:
      rawSort !== null && Object.prototype.hasOwnProperty.call(SORT_LABEL, rawSort)
        ? (rawSort as DocumentSort)
        : "updated_at",
    order: rawOrder === "asc" ? "asc" : "desc",
    category: searchParams.get("category") ?? "",
    format: rawFormat === "pdf" || rawFormat === "txt" ? rawFormat : "",
    warning: searchParams.get("warning") === "1",
    q: searchParams.get("q") ?? "",
  };
}

/** 序列化为查询串，非默认值才写入，保持 URL 干净。 */
function listQueryString(params: ListParams): string {
  const query = new URLSearchParams();
  if (params.page !== 1) {
    query.set("page", String(params.page));
  }
  if (params.sort !== "updated_at") {
    query.set("sort", params.sort);
  }
  if (params.order !== "desc") {
    query.set("order", params.order);
  }
  if (params.category !== "") {
    query.set("category", params.category);
  }
  if (params.format !== "") {
    query.set("format", params.format);
  }
  if (params.warning) {
    query.set("warning", "1");
  }
  if (params.q !== "") {
    query.set("q", params.q);
  }
  return query.toString();
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

function documentHref(documentId: string, knowledgeBaseId: string, backQuery: string): string {
  const params = new URLSearchParams({ kb: knowledgeBaseId });
  if (backQuery !== "") {
    params.set("back", backQuery);
  }
  return `/documents/${encodeURIComponent(documentId)}?${params.toString()}`;
}

interface MetaBundle {
  knowledgeBase: KnowledgeBase;
  stats: KnowledgeBaseStats;
}

/** 导入健康度：只在知识库或统计变化时重新渲染。 */
const StatsSection = memo(function StatsSection({ stats }: { stats: KnowledgeBaseStats }) {
  return (
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
            <div className="stat__label">分块数</div>
            <div className="stat__value">{stats.chunk_count}</div>
            <div className="stat__hint">已向量化 {stats.embedded_chunk_count}</div>
          </div>
        </div>
      </div>
    </section>
  );
});

interface RowProps {
  doc: DocumentSummary;
  focused: boolean;
  knowledgeBaseId: string;
  backQuery: string;
}

/** 单行文档；换页时未变化的行不会重新渲染。 */
const DocumentRow = memo(function DocumentRow({
  doc,
  focused,
  knowledgeBaseId,
  backQuery,
}: RowProps) {
  const status = doc.current_version?.policy_status ?? "unknown";
  return (
    <tr className={focused ? "table__row--focus" : undefined}>
      <td>
        <Link className="table__link" to={documentHref(doc.id, knowledgeBaseId, backQuery)}>
          {doc.title}
        </Link>
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
      <td className="table__numeric">{formatSize(doc.file_size)}</td>
      <td className="table__numeric">{formatDate(doc.updated_at)}</td>
    </tr>
  );
});

export function KnowledgeDetailPage() {
  const { knowledgeBaseId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const listParams = useMemo(() => readListParams(searchParams), [searchParams]);
  const focusedDocId = searchParams.get("doc");
  const listQuery = listQueryString(listParams);

  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  /** 修改 URL 中的列表条件；保留 `doc` 等其他参数。 */
  const updateListParams = useCallback(
    (patch: Partial<ListParams>) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          const merged = { ...readListParams(previous), ...patch };
          for (const key of LIST_KEYS) {
            next.delete(key);
          }
          new URLSearchParams(listQueryString(merged)).forEach((value, key) => {
            next.set(key, value);
          });
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const [keyword, setKeyword] = useState(listParams.q);

  const metaFetcher = useCallback(async (): Promise<MetaBundle> => {
    const [knowledgeBase, stats] = await Promise.all([
      getKnowledgeBase(apiClient, knowledgeBaseId),
      getKnowledgeBaseStats(apiClient, knowledgeBaseId),
    ]);
    return { knowledgeBase, stats };
  }, [knowledgeBaseId]);
  const meta = useLoader<MetaBundle>(metaFetcher);
  const updateMeta = meta.setData;

  const listFetcher = useCallback(
    () =>
      listDocuments(apiClient, {
        knowledge_base_id: knowledgeBaseId,
        page: listParams.page,
        page_size: PAGE_SIZE,
        sort: listParams.sort,
        order: listParams.order,
        category: listParams.category === "" ? undefined : listParams.category,
        format: listParams.format === "" ? undefined : listParams.format,
        has_warning: listParams.warning ? true : undefined,
        q: listParams.q === "" ? undefined : listParams.q,
      }),
    [
      knowledgeBaseId,
      listParams.page,
      listParams.sort,
      listParams.order,
      listParams.category,
      listParams.format,
      listParams.warning,
      listParams.q,
    ],
  );
  const list = useLoader<Page<DocumentSummary>>(listFetcher, { keepData: true });

  const focusedFetcher = useCallback(
    () =>
      focusedDocId === null
        ? Promise.resolve(null)
        : getDocument(apiClient, focusedDocId).catch(() => null),
    [focusedDocId],
  );
  const focused = useLoader<DocumentDetail | null>(focusedFetcher);

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

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function beginEdit(knowledgeBase: KnowledgeBase): void {
    setEditName(knowledgeBase.name);
    setEditDescription(knowledgeBase.description ?? "");
    setEditError(null);
    setEditing(true);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (editName.trim() === "") {
      setEditError("知识库名称不能为空。");
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      const updated = await updateKnowledgeBase(apiClient, knowledgeBaseId, {
        name: editName.trim(),
        description: editDescription.trim() === "" ? null : editDescription.trim(),
      });
      updateMeta((previous) =>
        previous === null ? null : { ...previous, knowledgeBase: updated },
      );
      setEditing(false);
    } catch (caught) {
      setEditError(caught instanceof ApiError ? caught.message : "保存失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  function handleSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    updateListParams({ q: keyword.trim(), page: 1 });
  }

  if (meta.loading && meta.data === null) {
    return <PageState kind="loading" title="正在加载知识库…" />;
  }

  if (meta.error) {
    return (
      <PageState
        kind="error"
        title="加载知识库失败"
        description={meta.error.message}
        errorCode={meta.error.code}
        actions={
          <>
            <button type="button" className="btn" onClick={meta.reload}>
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

  if (meta.data === null) {
    return <PageState title="知识库不存在" description="该知识库可能已被删除。" />;
  }

  const { knowledgeBase, stats } = meta.data;
  const focusedDocument = focused.data;
  const documents = list.data;
  const hasFilter =
    listParams.category !== "" ||
    listParams.format !== "" ||
    listParams.warning ||
    listParams.q !== "";
  const listing = list.loading && documents !== null;

  return (
    <div className="stack stack--section">
      <Breadcrumb items={[{ label: "知识库", to: "/knowledge" }, { label: knowledgeBase.name }]} />

      <div className="page-head">
        <div>
          <h2 className="page-head__title">{knowledgeBase.name}</h2>
          <p className="page-head__desc">{knowledgeBase.description ?? "该知识库暂无描述。"}</p>
        </div>

        <div className="page-head__actions">
          <Link className="btn btn--ghost" to="/knowledge">
            返回列表
          </Link>
          {isAdmin ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => beginEdit(knowledgeBase)}
            >
              编辑信息
            </button>
          ) : null}
          <Link className="btn" to={`/import?kb=${knowledgeBaseId}`}>
            导入文档
          </Link>
        </div>
      </div>

      {editing ? (
        <section className="card">
          <div className="card__header">
            <h3 className="card__title">编辑知识库</h3>
          </div>
          <div className="card__body">
            <form className="stack" onSubmit={(event) => void handleSave(event)}>
              <label className="field">
                <span className="field__label">名称</span>
                <input
                  className="field__input"
                  value={editName}
                  maxLength={80}
                  onChange={(event) => setEditName(event.target.value)}
                  required
                />
              </label>

              <label className="field">
                <span className="field__label">描述（可选）</span>
                <textarea
                  className="field__input"
                  rows={3}
                  maxLength={500}
                  value={editDescription}
                  placeholder="说明该知识库收录哪些制度材料；留空表示删除描述"
                  onChange={(event) => setEditDescription(event.target.value)}
                />
              </label>

              {editError ? (
                <p className="field__error" role="alert">
                  {editError}
                </p>
              ) : null}

              <div className="row">
                <button type="submit" className="btn" disabled={saving}>
                  {saving ? "保存中…" : "保存"}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={saving}
                  onClick={() => setEditing(false)}
                >
                  取消
                </button>
                <span className="faint">描述可随时修改，用于说明该知识库收录范围。</span>
              </div>
            </form>
          </div>
        </section>
      ) : null}

      {focusedDocument === null ? null : (
        <section className="card">
          <div className="card__header">
            <h3 className="card__title">已定位到来源文档</h3>
            <Link
              className="btn btn--sm"
              to={documentHref(focusedDocument.id, knowledgeBaseId, listQuery)}
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

      <StatsSection stats={stats} />

      <section className="card" aria-busy={listing}>
        <div className="card__header">
          <h3 className="card__title">文档</h3>
          <span className="faint">
            {documents === null ? "正在读取文档列表…" : `共 ${String(documents.total)} 份`}
            {listing ? " · 更新中…" : ""}
          </span>
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
                value={listParams.sort}
                onChange={(event) => {
                  updateListParams({ sort: event.target.value as DocumentSort, page: 1 });
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
                aria-label={listParams.order === "asc" ? "切换为降序" : "切换为升序"}
                onClick={() => {
                  updateListParams({ order: listParams.order === "asc" ? "desc" : "asc", page: 1 });
                }}
              >
                {listParams.order === "asc" ? "↑ 升序" : "↓ 降序"}
              </button>

              <label className="sr-only" htmlFor="doc-category">
                按分类筛选
              </label>
              <select
                id="doc-category"
                className="field__input toolbar__select"
                value={listParams.category}
                onChange={(event) => {
                  updateListParams({ category: event.target.value, page: 1 });
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
                value={listParams.format}
                onChange={(event) => {
                  updateListParams({
                    format: event.target.value as DocumentFormat | "",
                    page: 1,
                  });
                }}
              >
                <option value="">全部格式</option>
                <option value="txt">TXT 文本</option>
                <option value="pdf">PDF 文档</option>
              </select>

              <label className="row">
                <input
                  type="checkbox"
                  checked={listParams.warning}
                  onChange={(event) => {
                    updateListParams({ warning: event.target.checked, page: 1 });
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
          {list.error !== null && documents !== null ? (
            <div className="card__notice">
              <p className="field__error" role="alert">
                文档列表更新失败：{list.error.message}
              </p>
              <button type="button" className="btn btn--ghost btn--sm" onClick={list.reload}>
                重试
              </button>
            </div>
          ) : null}
          {list.error !== null && documents === null ? (
            <PageState
              kind="error"
              title="加载文档列表失败"
              description={list.error.message}
              errorCode={list.error.code}
              actions={
                <button type="button" className="btn" onClick={list.reload}>
                  重试
                </button>
              }
            />
          ) : documents !== null && documents.items.length > 0 ? (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">制度文档</th>
                      <th scope="col">时效状态</th>
                      <th scope="col">大小</th>
                      <th scope="col">更新时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.items.map((doc) => (
                      <DocumentRow
                        key={doc.id}
                        doc={doc}
                        focused={doc.id === focusedDocId}
                        knowledgeBaseId={knowledgeBaseId}
                        backQuery={listQuery}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <Pagination
                page={documents.page}
                pageSize={documents.page_size}
                total={documents.total}
                hasNext={documents.has_next}
                disabled={listing}
                onChange={(next) => {
                  updateListParams({ page: next });
                }}
              />
            </>
          ) : documents === null ? (
            <PageState kind="loading" title="正在加载文档列表…" />
          ) : hasFilter ? (
            <PageState
              title="没有匹配的文档"
              description="换一个分类、格式或关键词，或清空筛选后重试。"
              actions={
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setKeyword("");
                    updateListParams({
                      category: "",
                      format: "",
                      warning: false,
                      q: "",
                      page: 1,
                    });
                  }}
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
        </div>
      </section>
    </div>
  );
}
