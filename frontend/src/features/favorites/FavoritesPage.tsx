/**
 * 我的收藏页。
 *
 * 对应 docs/api/系统接口.md §9.4（列表）、§9.6（取消收藏）。
 * 收藏只保存摘要，不复制全文；原问答记录删除后收藏随之失效。
 */
import { useCallback, useState } from "react";

import { ApiError } from "../../api/errors";
import { listFavorites, removeFavorite } from "../../api/favorites";
import { apiClient } from "../../api/session";
import { Badge } from "../../components/Badge";
import type { BadgeVariant } from "../../components/Badge";
import { PageState } from "../../components/PageState";
import { Pagination } from "../../components/Pagination";
import { useLoader } from "../../hooks/useLoader";
import type { Page } from "../../types/api";
import type { FavoriteRecord } from "../../types/history";
import type { EvidenceLevel } from "../../types/qa";

const PAGE_SIZE = 10;

const LEVEL_LABEL: Record<EvidenceLevel, string> = {
  none: "无依据",
  weak: "较弱",
  moderate: "中等",
  strong: "较强",
};

const LEVEL_VARIANT: Record<EvidenceLevel, BadgeVariant> = {
  none: "neutral",
  weak: "danger",
  moderate: "warning",
  strong: "success",
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

export function FavoritesPage() {
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetcher = useCallback(
    () => listFavorites(apiClient, { page, page_size: PAGE_SIZE }),
    [page],
  );
  const { data, error, loading, reload, beginLoad } = useLoader<Page<FavoriteRecord>>(fetcher);

  async function handleRemove(record: FavoriteRecord): Promise<void> {
    setActionError(null);
    try {
      await removeFavorite(apiClient, record.id);
      reload();
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "取消收藏失败，请稍后重试。");
    }
  }

  return (
    <div className="stack stack--section">
      <div className="page-head">
        <div>
          <h2 className="page-head__title">我的收藏</h2>
          <p className="page-head__desc">
            收藏引用原问答记录而不复制全文；原记录被删除后，对应收藏会一并移除。
          </p>
        </div>
      </div>

      {actionError ? (
        <p className="field__error" role="alert">
          {actionError}
        </p>
      ) : null}

      <section className="card">
        <div className="card__header">
          <h3 className="card__title">收藏列表</h3>
          {data ? <span className="faint">共 {data.total} 条</span> : null}
        </div>

        <div className="card__body card__body--flush">
          {loading ? (
            <PageState kind="loading" title="正在加载收藏…" />
          ) : error ? (
            <PageState
              kind="error"
              title="加载收藏失败"
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
                  const percent = Math.round(record.evidence_support.score * 100);
                  return (
                    <li className="record" key={record.id}>
                      <div className="record__head">
                        <div>
                          <p className="record__question">{record.question}</p>
                          <div className="record__meta">
                            <span>{formatDate(record.created_at)}</span>
                            <span>{record.citation_count} 条引用</span>
                            <Badge variant={LEVEL_VARIANT[record.evidence_support.level]}>
                              证据支持度：{LEVEL_LABEL[record.evidence_support.level]} {percent}%
                            </Badge>
                          </div>
                        </div>

                        <div className="record__actions">
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => void handleRemove(record)}
                          >
                            取消收藏
                          </button>
                        </div>
                      </div>

                      <p className="record__body">{record.answer_excerpt}</p>
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
              title="还没有收藏"
              description="在「问答历史」中收藏有价值的回答，方便日后查阅。"
            />
          )}
        </div>
      </section>
    </div>
  );
}
