/**
 * 知识库列表页。
 *
 * 对应 docs/api/系统接口.md §7.1（列表）、§7.3（创建）。
 */
import { useCallback, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "../../api/errors";
import { createKnowledgeBase, listKnowledgeBases } from "../../api/knowledge";
import { apiClient } from "../../api/session";
import { PageState } from "../../components/PageState";
import { Pagination } from "../../components/Pagination";
import { useLoader } from "../../hooks/useLoader";
import { useAuth } from "../../stores/auth";
import type { Page } from "../../types/api";
import type { KnowledgeBase } from "../../types/knowledge";

const PAGE_SIZE = 10;

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

export function KnowledgePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [keyword, setKeyword] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [page, setPage] = useState(1);

  const fetcher = useCallback(
    () =>
      listKnowledgeBases(apiClient, {
        page,
        page_size: PAGE_SIZE,
        q: appliedKeyword === "" ? undefined : appliedKeyword,
      }),
    [page, appliedKeyword],
  );
  const { data, error, loading, reload, beginLoad } = useLoader<Page<KnowledgeBase>>(fetcher);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    beginLoad();
    setPage(1);
    setAppliedKeyword(keyword.trim());
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (newName.trim() === "") {
      return;
    }

    setSubmitting(true);
    setCreateError(null);
    try {
      await createKnowledgeBase(apiClient, {
        name: newName.trim(),
        description: newDescription.trim() === "" ? undefined : newDescription.trim(),
      });
      setNewName("");
      setNewDescription("");
      setCreating(false);
      setPage(1);
      reload();
    } catch (caught) {
      setCreateError(caught instanceof ApiError ? caught.message : "创建知识库失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="stack stack--section">
      <div className="page-head">
        <div>
          <h2 className="page-head__title">知识库</h2>
          <p className="page-head__desc">
            知识库是一组制度文档与版本的集合，用于限定问答的检索范围。
          </p>
        </div>

        <div className="page-head__actions">
          <form className="toolbar" onSubmit={handleSearch}>
            <label className="sr-only" htmlFor="kb-keyword">
              搜索知识库
            </label>
            <input
              id="kb-keyword"
              className="field__input toolbar__input"
              placeholder="按名称或描述搜索"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <button type="submit" className="btn btn--ghost btn--sm">
              搜索
            </button>
          </form>

          {isAdmin ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setCreateError(null);
                setCreating((value) => !value);
              }}
            >
              {creating ? "取消" : "新建知识库"}
            </button>
          ) : null}
        </div>
      </div>

      {creating ? (
        <section className="card">
          <div className="card__header">
            <h3 className="card__title">新建知识库</h3>
          </div>
          <div className="card__body">
            <form className="stack" onSubmit={(event) => void handleCreate(event)}>
              <label className="field">
                <span className="field__label">名称</span>
                <input
                  className="field__input"
                  value={newName}
                  maxLength={80}
                  placeholder="例如：金融监管制度库"
                  onChange={(event) => setNewName(event.target.value)}
                  required
                />
              </label>

              <label className="field">
                <span className="field__label">描述（可选）</span>
                <input
                  className="field__input"
                  value={newDescription}
                  maxLength={500}
                  placeholder="说明该知识库收录哪些制度材料"
                  onChange={(event) => setNewDescription(event.target.value)}
                />
              </label>

              {createError ? (
                <p className="field__error" role="alert">
                  {createError}
                </p>
              ) : null}

              <div className="row">
                <button
                  type="submit"
                  className="btn"
                  disabled={submitting || newName.trim() === ""}
                >
                  {submitting ? "创建中…" : "创建"}
                </button>
                <span className="faint">名称需全局唯一，最长 80 字符。</span>
              </div>
            </form>
          </div>
        </section>
      ) : null}

      <section className="card">
        <div className="card__header">
          <h3 className="card__title">全部知识库</h3>
          {data ? <span className="faint">共 {data.total} 个</span> : null}
        </div>

        <div className="card__body card__body--flush">
          {loading ? (
            <PageState kind="loading" title="正在加载知识库…" />
          ) : error ? (
            <PageState
              kind="error"
              title="加载知识库失败"
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
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">名称</th>
                      <th scope="col">文档数</th>
                      <th scope="col">分块数</th>
                      <th scope="col">更新时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <Link className="table__link" to={`/knowledge/${item.id}`}>
                            {item.name}
                          </Link>
                          {item.description ? (
                            <div className="table__sub">{item.description}</div>
                          ) : null}
                        </td>
                        <td className="table__numeric">{item.document_count}</td>
                        <td className="table__numeric">{item.chunk_count}</td>
                        <td className="table__numeric">{formatDate(item.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

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
              title={appliedKeyword === "" ? "还没有知识库" : "没有匹配的知识库"}
              description={
                appliedKeyword === ""
                  ? "新建一个知识库后即可导入制度文档。"
                  : "换一个关键词，或清空搜索条件后重试。"
              }
            />
          )}
        </div>
      </section>
    </div>
  );
}
