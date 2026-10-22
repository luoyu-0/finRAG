/**
 * 条文引用列表。
 *
 * 这是本项目「条文溯源」的核心展示：每条引用都能定位到制度标题、
 * 条文编号、页码与分块，排版采用文献式语言（衬线标题 + 细线 + 引文感）。
 */
import type { Citation } from "../types/qa";

function MetaItem({ children }: { children: string }) {
  return <span className="citation__meta-item">{children}</span>;
}

export function CitationList({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) {
    return <p className="faint">本次回答没有引用任何制度条文。</p>;
  }

  return (
    <ol className="citation-list">
      {citations.map((citation) => {
        const page = citation.page_number === null ? null : `第 ${String(citation.page_number)} 页`;

        return (
          <li className="citation" key={citation.chunk_id}>
            <div className="citation__head">
              <span className="citation__label">[{citation.label}]</span>
              <span className="citation__title">{citation.title}</span>
            </div>

            <div className="citation__meta">
              {citation.article_number ? (
                <span className="citation__meta-item citation__article">
                  {citation.article_number}
                </span>
              ) : null}
              {page ? <MetaItem>{page}</MetaItem> : null}
              <MetaItem>{`分块 ${citation.chunk_id}`}</MetaItem>
            </div>

            <div className="citation__footer">
              {citation.source_url ? (
                <a href={citation.source_url} target="_blank" rel="noreferrer noopener">
                  查看原文
                </a>
              ) : (
                <span className="faint">该分块暂无公开来源链接</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
