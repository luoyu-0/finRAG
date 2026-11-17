/**
 * 文档正文页：从问答角标跳转过来，定位到被引条文在原文中的位置。
 *
 * 对应 docs/api/系统接口.md §8.3.1：TXT 返回全文并用字符区间高亮，
 * PDF 不能当文本渲染，改用按页重组的 blocks 并高亮命中分块。
 */
import { useCallback, useEffect, useRef } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { getDocumentContent } from "../../api/documents";
import { apiClient } from "../../api/session";
import { Badge } from "../../components/Badge";
import { PageState } from "../../components/PageState";
import { useLoader } from "../../hooks/useLoader";
import type { DocumentContent } from "../../types/knowledge";

const POLICY_LABEL = { active: "有效", inactive: "已失效", unknown: "未知" } as const;

function locationLabel(anchor: DocumentContent["anchor"]): string {
  if (anchor === null) {
    return "";
  }
  const parts: string[] = [];
  if (anchor.article_number) {
    parts.push(anchor.article_number);
  }
  if (anchor.page_number !== null) {
    parts.push(`第 ${String(anchor.page_number)} 页`);
  }
  return parts.join(" · ");
}

export function DocumentContentPage() {
  const { documentId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const chunkId = searchParams.get("chunk") ?? undefined;
  const knowledgeBaseId = searchParams.get("kb");

  const fetcher = useCallback(
    () => getDocumentContent(apiClient, documentId, chunkId),
    [documentId, chunkId],
  );
  const { data, error, loading, reload } = useLoader<DocumentContent>(fetcher);

  const hitRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (data?.anchor?.located) {
      // jsdom 等环境没有实现 scrollIntoView，缺少时静默跳过滚动，不影响高亮。
      hitRef.current?.scrollIntoView?.({ block: "center" });
    }
  }, [data]);

  if (loading) {
    return <PageState kind="loading" title="正在读取制度原文…" />;
  }

  if (error) {
    return (
      <PageState
        kind="error"
        title="读取原文失败"
        description={error.message}
        errorCode={error.code}
        actions={
          <>
            <button type="button" className="btn" onClick={reload}>
              重试
            </button>
            {knowledgeBaseId === null ? null : (
              <Link
                className="btn btn--ghost"
                to={`/knowledge/${encodeURIComponent(knowledgeBaseId)}`}
              >
                返回知识库
              </Link>
            )}
          </>
        }
      />
    );
  }

  if (data === null) {
    return <PageState title="文档不存在" description="该文档可能已被删除。" />;
  }

  const { anchor, text, blocks } = data;
  const span =
    text !== null &&
    anchor !== null &&
    anchor.located &&
    anchor.start !== null &&
    anchor.end !== null
      ? { start: anchor.start, end: anchor.end }
      : null;

  return (
    <div className="stack stack--section">
      <div className="page-head">
        <div>
          <h2 className="page-head__title">{data.title}</h2>
          <p className="page-head__desc">
            <span className="faint">{data.file_name}</span>
            {" · "}
            <Badge variant={data.policy_status === "active" ? "success" : "neutral"}>
              {POLICY_LABEL[data.policy_status]}
            </Badge>
            {anchor === null ? null : (
              <>
                {" · "}
                {anchor.located ? "已定位到引用条文：" : "原文未精确匹配，以下为引用摘录："}
                {locationLabel(anchor) || "相关条文"}
              </>
            )}
          </p>
        </div>

        <div className="page-head__actions">
          {knowledgeBaseId === null ? null : (
            <Link
              className="btn btn--ghost"
              to={`/knowledge/${encodeURIComponent(knowledgeBaseId)}${
                anchor === null ? "" : `?doc=${encodeURIComponent(data.id)}`
              }`}
            >
              返回知识库
            </Link>
          )}
        </div>
      </div>

      {anchor !== null && !anchor.located ? (
        <section className="card">
          <div className="card__header">
            <h3 className="card__title">引用摘录</h3>
            <span className="faint">原文中未匹配到该分块，可能与 OCR 文本存在差异</span>
          </div>
          <div className="card__body">
            <p className="doc-reader__excerpt">{anchor.excerpt}</p>
          </div>
        </section>
      ) : null}

      <section className="card">
        <div className="card__header">
          <h3 className="card__title">{data.source === "pdf" ? "正文（按页重组）" : "制度原文"}</h3>
          <span className="faint">
            {data.source === "pdf"
              ? `${String(blocks.length)} 个片段，同页内按条号排序`
              : data.source === "txt"
                ? "TXT 原文全文"
                : "原文缺失"}
          </span>
        </div>

        <div className="card__body">
          {data.source === "txt" && text !== null ? (
            <p className="doc-reader__text">
              {span === null ? (
                text
              ) : (
                <>
                  {text.slice(0, span.start)}
                  <mark className="doc-reader__hit" ref={hitRef as React.RefObject<HTMLElement>}>
                    {text.slice(span.start, span.end)}
                  </mark>
                  {text.slice(span.end)}
                </>
              )}
            </p>
          ) : data.source === "pdf" && blocks.length > 0 ? (
            <div className="doc-reader__blocks">
              {blocks.map((block) => {
                const isHit = anchor !== null && block.chunk_id === anchor.chunk_id;
                return (
                  <article
                    key={block.chunk_id}
                    className={isHit ? "doc-block doc-block--hit" : "doc-block"}
                    ref={isHit ? (hitRef as React.RefObject<HTMLElement>) : undefined}
                  >
                    <div className="doc-block__meta">
                      {block.article_number ?? "未标注条号"}
                      {block.page_number === null ? "" : ` · 第 ${String(block.page_number)} 页`}
                      {isHit ? <Badge variant="info">引用位置</Badge> : null}
                    </div>
                    <p className="doc-block__text">{block.text}</p>
                  </article>
                );
              })}
            </div>
          ) : (
            <PageState
              title="无法读取原文"
              description="原始文件不在服务器上，只能按条号与页码核对引用。"
            />
          )}
        </div>
      </section>
    </div>
  );
}
