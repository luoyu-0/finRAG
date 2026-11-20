/**
 * 文档正文页：制度原文阅读与引用定位。
 *
 * 对应 docs/api/系统接口.md §8.3.1（正文与定位）、§8.3.2（原文文件）：
 * - PDF 用 pdf.js 在页面内渲染，打开即定位到被引条文所在页，可翻页、缩放；
 * - TXT 渲染全文并用字符区间高亮被引条文；
 * - 原文文件不可用时退回按页与条号排序的分块摘录；
 * - 顶部面包屑标出「知识库 › 当前知识库 › 当前文档」，并保留返回列表的分页与筛选。
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { createDocumentFileTicket, getDocumentContent } from "../../api/documents";
import { ApiError } from "../../api/errors";
import { getKnowledgeBase } from "../../api/knowledge";
import { apiClient } from "../../api/session";
import { Badge } from "../../components/Badge";
import type { BreadcrumbItem } from "../../components/Breadcrumb";
import { Breadcrumb } from "../../components/Breadcrumb";
import { PageState } from "../../components/PageState";
import { useLoader } from "../../hooks/useLoader";
import type { DocumentContent } from "../../types/knowledge";

/**
 * pdf.js 只在需要渲染 PDF 时加载：TXT 正文、单元测试与 jsdom 环境都不会引入阅读器。
 */
const PdfViewer = lazy(() =>
  import("../../components/PdfViewer").then((module) => ({ default: module.PdfViewer })),
);

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

/** 仅真正的 PDF 原文件交给浏览器原生阅读器，其他格式仍按分块展示。 */
function isRenderablePdf(data: DocumentContent): boolean {
  return data.source === "pdf" && data.has_file && /\.pdf$/i.test(data.file_name);
}

interface TicketState {
  documentId: string;
  url: string;
}

export function DocumentContentPage() {
  const { documentId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const chunkId = searchParams.get("chunk") ?? undefined;
  const knowledgeBaseId = searchParams.get("kb");
  /** 从文档列表跳转时带上的列表查询串，返回时原样带回以保留页码与筛选。 */
  const backQuery = searchParams.get("back") ?? "";

  const fetcher = useCallback(
    () => getDocumentContent(apiClient, documentId, chunkId),
    [documentId, chunkId],
  );
  const { data, error, loading, reload } = useLoader<DocumentContent>(fetcher);

  const [knowledgeBaseName, setKnowledgeBaseName] = useState<{ id: string; name: string } | null>(
    null,
  );
  useEffect(() => {
    if (knowledgeBaseId === null) {
      return;
    }
    let alive = true;
    getKnowledgeBase(apiClient, knowledgeBaseId)
      .then((knowledgeBase) => {
        if (alive) {
          setKnowledgeBaseName({ id: knowledgeBase.id, name: knowledgeBase.name });
        }
        return undefined;
      })
      .catch(() => {
        // 面包屑降级为知识库 ID，不影响正文阅读。
      });
    return () => {
      alive = false;
    };
  }, [knowledgeBaseId]);

  const [ticket, setTicket] = useState<TicketState | null>(null);
  const [fileError, setFileError] = useState<{ documentId: string; message: string } | null>(null);
  const pdfAvailable = data !== null && isRenderablePdf(data);

  useEffect(() => {
    if (!pdfAvailable) {
      return;
    }
    let alive = true;
    createDocumentFileTicket(apiClient, documentId)
      .then((result) => {
        if (alive && result.url !== "") {
          setTicket({ documentId, url: result.url });
        }
        return undefined;
      })
      .catch((caught: unknown) => {
        if (!alive) {
          return;
        }
        setFileError({
          documentId,
          message: caught instanceof ApiError ? caught.message : "原文文件暂时无法读取。",
        });
      });
    return () => {
      alive = false;
    };
  }, [pdfAvailable, documentId]);

  // 换文档时不需要清理状态：读取时按 documentId 判定，旧值自然失效。
  const hitRef = useRef<HTMLElement | null>(null);

  const anchor = data?.anchor ?? null;
  const totalPages = data?.page_count ?? 0;
  const anchorPage = anchor?.page_number ?? null;
  const fileUrl = ticket?.documentId === documentId ? ticket.url : null;

  useEffect(() => {
    if (data?.anchor?.located) {
      // jsdom 等环境没有实现 scrollIntoView，缺少时静默跳过滚动，不影响高亮。
      hitRef.current?.scrollIntoView?.({ block: "center" });
    }
  }, [data]);

  const backHref =
    knowledgeBaseId === null
      ? null
      : `/knowledge/${encodeURIComponent(knowledgeBaseId)}${backQuery === "" ? "" : `?${backQuery}`}`;

  const crumbs: BreadcrumbItem[] =
    knowledgeBaseId === null
      ? []
      : [
          { label: "知识库", to: "/knowledge" },
          {
            label:
              knowledgeBaseName !== null && knowledgeBaseName.id === knowledgeBaseId
                ? knowledgeBaseName.name
                : knowledgeBaseId,
            to: backHref ?? `/knowledge/${encodeURIComponent(knowledgeBaseId)}`,
          },
          { label: data?.title ?? "文档正文" },
        ];

  if (loading && data === null) {
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
            {backHref === null ? null : (
              <Link className="btn btn--ghost" to={backHref}>
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

  const { text, blocks } = data;
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
      {crumbs.length === 0 ? null : <Breadcrumb items={crumbs} />}

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
          {backHref === null ? null : (
            <Link className="btn btn--ghost" to={backHref}>
              返回知识库
            </Link>
          )}
        </div>
      </div>

      {anchor !== null && (!anchor.located || pdfAvailable) ? (
        <section className="card">
          <div className="card__header">
            <h3 className="card__title">{anchor.located ? "引用原文" : "引用摘录"}</h3>
            <span className="faint">
              {anchor.located
                ? locationLabel(anchor) || "相关条文"
                : "原文中未匹配到该分块，可能与 OCR 文本存在差异"}
            </span>
          </div>
          <div className="card__body">
            <p className="doc-reader__excerpt">{anchor.excerpt}</p>
          </div>
        </section>
      ) : null}

      {pdfAvailable ? (
        <section className="card">
          <div className="card__header">
            <h3 className="card__title">PDF 原文</h3>
            <span className="faint">
              页面内渲染，可翻页、缩放与跳转
              {totalPages > 0 ? `，共 ${String(totalPages)} 页` : ""}
            </span>
          </div>

          <div className="card__body">
            <div className="doc-reader__pdf-bar">
              <span className="faint">
                打开时定位到第 {String(anchorPage ?? 1)} 页
                {anchorPage === null ? "" : "（引用所在页）"}
              </span>
              {fileUrl === null ? null : (
                <a
                  className="btn btn--ghost btn--sm"
                  href={fileUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  新标签打开
                </a>
              )}
            </div>

            {fileUrl === null ? (
              fileError !== null && fileError.documentId === documentId ? (
                <PageState
                  kind="error"
                  title="无法加载 PDF 原文"
                  description={fileError.message}
                  actions={
                    <button type="button" className="btn" onClick={reload}>
                      重试
                    </button>
                  }
                />
              ) : (
                <PageState kind="loading" title="正在加载 PDF…" />
              )
            ) : (
              <Suspense fallback={<PageState kind="loading" title="正在加载 PDF 阅读器…" />}>
                <PdfViewer src={fileUrl} initialPage={anchorPage ?? 1} title={data.title} />
              </Suspense>
            )}
          </div>
        </section>
      ) : (
        <section className="card">
          <div className="card__header">
            <h3 className="card__title">{data.source === "txt" ? "制度原文" : "分块摘录"}</h3>
            <span className="faint">
              {data.source === "txt"
                ? "TXT 原文全文"
                : blocks.length > 0
                  ? "原文文件不可在浏览器中渲染，按页与条号展示被切分的分块"
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
      )}
    </div>
  );
}
