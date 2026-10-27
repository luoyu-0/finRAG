/**
 * 问答历史页。
 *
 * 对应 docs/api/系统接口.md §9.1（列表）、§9.3（删除）、§9.5–§9.6（收藏）。
 * 记录可展开查看完整回答、证据支持度与条文引用。
 */
import { useCallback, useState } from "react";
import type { FormEvent } from "react";

import { ApiError } from "../../api/errors";
import { addFavorite, removeFavorite } from "../../api/favorites";
import { deleteHistory, listHistory } from "../../api/history";
import { apiClient } from "../../api/session";
import { Badge } from "../../components/Badge";
import { CitationList } from "../../components/CitationList";
import { EvidenceMeter } from "../../components/EvidenceMeter";
import { PageState } from "../../components/PageState";
import { Pagination } from "../../components/Pagination";
import { useLoader } from "../../hooks/useLoader";
import type { Page } from "../../types/api";
import type { QaRecord } from "../../types/history";

const PAGE_SIZE = 10;
const EXCERPT_LENGTH = 90;

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

export function HistoryPage() {
  const [keyword, setKeyword] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [onlyFavorited, setOnlyFavorited] = useState(false);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetcher = useCallback(
    () =>
      listHistory(apiClient, {
        page,
        page_size: PAGE_SIZE,
        q: appliedKeyword === "" ? undefined : appliedKeyword,
        favorited: onlyFavorited ? true : undefined,
      }),
    [page, appliedKeyword, onlyFavorited],
  );
  const { data, error, loading, reload, beginLoad } = useLoader<Page<QaRecord>>(fetcher);

  function handleSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    beginLoad();
    setPage(1);
    setAppliedKeyword(keyword.trim());
  }

  async function handleToggleFavorite(record: QaRecord): Promise<void> {
    setActionError(null);
    try {
      if (record.favorited && record.favorite_id !== null) {
        await removeFavorite(apiClient, record.favorite_id);
      } else {
        await addFavorite(apiClient, record.id);
      }
      reload();
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "操作失败，请稍后重试。");
    }
  }

  async function handleDelete(record: QaRecord): Promise<void> {
    setActionError(null);
    try {
      await deleteHistory(apiClient, record.id);
      reload();
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "删除失败，请稍后重试。");
    }
  }

  return (
    <div className="stack stack--section">
      <div className="page-head">
        <div>
          <h2 className="page-head__title">问答历史</h2>
          <p className="page-head__desc">
            每次提问都会自动记录回答、引用与证据支持度，可展开查看完整内容。
          </p>
        </div>

        <form className="toolbar" onSubmit={handleSearch}>
          <label className="sr-only" htmlFor="history-keyword">
            搜索问答历史
          </label>
          <input
            id="history-keyword"
            className="field__input toolbar__input"
            placeholder="按问题搜索"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <label className="row">
            <input
              type="checkbox"
              checked={onlyFavorited}
              onChange={(event) => {
                beginLoad();
                setOnlyFavorited(event.target.checked);
                setPage(1);
              }}
            />
            <span className="faint">只看已收藏</span>
          </label>
          <button type="submit" className="btn btn--ghost btn--sm">
            搜索
          </button>
        </form>
      </div>

      {actionError ? (
        <p className="field__error" role="alert">
          {actionError}
        </p>
      ) : null}

      <section className="card">
        <div className="card__header">
          <h3 className="card__title">全部记录</h3>
          {data ? <span className="faint">共 {data.total} 条</span> : null}
        </div>

        <div className="card__body card__body--flush">
          {loading ? (
            <PageState kind="loading" title="正在加载问答历史…" />
          ) : error ? (
            <PageState
              kind="error"
              title="加载问答历史失败"
              description={error.message}
              errorCode={error.code}
              actions={
                <button type="button" className="btn btn--ghost" onClick={reload}>
                  重试
                </button>
              }
            />
          ) : data && data.items.length > 0 ? (
            <>
              <ul>
                {data.items.map((record) => {
                  const expanded = expandedId === record.id;
                  const percent = Math.round(record.evidence_support.score * 100);

                  return (
                    <li className="record" key={record.id}>
                      <div className="record__head">
                        <div>
                          <p className="record__question">{record.question}</p>
                          <div className="record__meta">
                            <span>{formatDate(record.created_at)}</span>
                            <span>证据支持度 {percent}%</span>
                            <span>{record.citations.length} 条引用</span>
                            {record.favorited ? <Badge variant="info">已收藏</Badge> : null}
                          </div>
                        </div>

                        <div className="record__actions">
                          <button
                            type="button"
                            className="record__toggle"
                            onClick={() => setExpandedId(expanded ? null : record.id)}
                          >
                            {expanded ? "收起" : "展开"}
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => void handleToggleFavorite(record)}
                          >
                            {record.favorited ? "取消收藏" : "收藏"}
                          </button>
                          <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            onClick={() => void handleDelete(record)}
                          >
                            删除
                          </button>
                        </div>
                      </div>

                      {expanded ? (
                        <div className="stack">
                          <EvidenceMeter evidence={record.evidence_support} />
                          <p className="record__body">{record.answer}</p>
                          <CitationList citations={record.citations} />
                          <p className="qa__trace">trace_id: {record.trace_id}</p>
                        </div>
                      ) : (
                        <p className="record__body">
                          {record.answer.length > EXCERPT_LENGTH
                            ? `${record.answer.slice(0, EXCERPT_LENGTH)}…`
                            : record.answer}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>

              <Pagination
                page={data.page}
                pageSize={data.page_size}
                total={data.total}
                hasNext={data.has_next}
                onChange={(next) => {
                  beginLoad();
                  setPage(next);
                }}
              />
            </>
          ) : (
            <PageState
              title={appliedKeyword === "" && !onlyFavorited ? "还没有问答记录" : "没有匹配的记录"}
              description={
                appliedKeyword === "" && !onlyFavorited
                  ? "去「制度问答」提一个问题，记录会自动出现在这里。"
                  : "换一个关键词，或取消筛选后重试。"
              }
            />
          )}
        </div>
      </section>
    </div>
  );
}
