/**
 * 条文来源小卡片。
 *
 * 由 AnswerText 在角标旁渲染。只展示契约 §6 中 citations 提供的字段，
 * 不臆造后端没有返回的信息。
 */
import type { Citation } from "../types/qa";

/** 分块 ID 在真实索引里是 32 位摘要，卡片里只显示前 8 位，完整值放在 title。 */
const CHUNK_ID_VISIBLE_LENGTH = 16;

function MetaItem({ children, title }: { children: string; title?: string }) {
  return (
    <span className="cite-pop__meta-item" title={title}>
      {children}
    </span>
  );
}

function formatChunkId(chunkId: string): string {
  return chunkId.length > CHUNK_ID_VISIBLE_LENGTH ? `${chunkId.slice(0, 8)}…` : chunkId;
}

interface CitationPopoverProps {
  citation: Citation | undefined;
  onClose: () => void;
  /**
   * 触屏下的跳转入口。桌面端点击角标即可跳转，不需要这个按钮，
   * 因此由调用方决定是否传入。
   */
  onOpenDocument?: (() => void) | undefined;
  /** 角标靠近视口右侧时改为左对齐，避免卡片被视口裁掉。 */
  alignRight?: boolean;
}

export function CitationPopover({
  citation,
  onClose,
  onOpenDocument,
  alignRight = false,
}: CitationPopoverProps) {
  if (citation === undefined) {
    return null;
  }

  return (
    <span className={alignRight ? "cite-pop cite-pop--right" : "cite-pop"}>
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
        <MetaItem title={citation.chunk_id}>{`分块 ${formatChunkId(citation.chunk_id)}`}</MetaItem>
      </span>

      {citation.excerpt ? <span className="cite-pop__quote">{citation.excerpt}</span> : null}

      <span className="cite-pop__foot">
        {onOpenDocument ? (
          <button type="button" className="cite-pop__open" onClick={onOpenDocument}>
            在知识库中查看
          </button>
        ) : null}
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
