/**
 * 条文来源小卡片。
 *
 * 由 AnswerText 在角标旁渲染。只展示契约 §6 中 citations 提供的字段，
 * 不臆造后端没有返回的信息。
 */
import type { Citation } from "../types/qa";

function MetaItem({ children }: { children: string }) {
  return <span className="cite-pop__meta-item">{children}</span>;
}

interface CitationPopoverProps {
  citation: Citation | undefined;
  onClose: () => void;
}

export function CitationPopover({ citation, onClose }: CitationPopoverProps) {
  if (citation === undefined) {
    return null;
  }

  return (
    <span className="cite-pop">
      <span className="cite-pop__head">
        <span className="cite-pop__label">[{citation.label}]</span>
        <span className="cite-pop__title">{citation.title}</span>
        <button
          type="button"
          className="cite-pop__close"
          onClick={onClose}
          aria-label="关闭来源卡片"
        >
          ×
        </button>
      </span>

      <span className="cite-pop__meta">
        {citation.article_number ? (
          <span className="cite-pop__meta-item cite-pop__article">{citation.article_number}</span>
        ) : null}
        {citation.page_number === null ? null : (
          <MetaItem>{`第 ${String(citation.page_number)} 页`}</MetaItem>
        )}
        <MetaItem>{`分块 ${citation.chunk_id}`}</MetaItem>
      </span>

      {citation.excerpt ? <span className="cite-pop__quote">{citation.excerpt}</span> : null}

      <span className="cite-pop__foot">
        {citation.source_url ? (
          <a href={citation.source_url} target="_blank" rel="noreferrer noopener">
            查看原文
          </a>
        ) : (
          <span className="faint">该分块暂无公开来源链接</span>
        )}
      </span>
    </span>
  );
}
