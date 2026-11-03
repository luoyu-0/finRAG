/**
 * 带条文角标的回答正文。
 *
 * 交互（按界面评审意见调整）：
 * - **悬停**角标即显示来源卡片；移开后延迟收起，留出把指针移入卡片的时间；
 * - **点击**角标跳转到知识库页面，并定位到该条引用对应的文档；
 * - 键盘可用：聚焦角标同样显示卡片，`Esc` 收起。
 *
 * 同一引用标签可能在正文出现多次，展开状态按**段落下标**记录，
 * 否则同一标签的多个角标会同时弹出卡片。
 *
 * 若正文没有任何标记（后端尚未按契约输出），调用方应回退为纯文本 + 来源列表，
 * 因此本模块额外导出 `hasCitationMarkers` 供调用方判断。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { CitationPopover } from "./CitationPopover";
import type { Citation } from "../types/qa";

export type AnswerSegment =
  { kind: "text"; value: string } | { kind: "cite"; label: string; order: number };

const MARKER_PATTERN = /\[(S\d+)\]/;
const MARKER_SOURCE = "\\[(S\\d+)\\]";
/** 移开指针后的收起延迟：让使用者有时间把指针移进卡片点击链接。 */
const HOVER_CLOSE_DELAY_MS = 240;

/** 正文是否内嵌了引用标记。 */
export function hasCitationMarkers(text: string): boolean {
  return MARKER_PATTERN.test(text);
}

/** 去掉引用标记，用于列表摘要等纯文本场景。 */
export function stripCitationMarkers(text: string): string {
  return text.replace(new RegExp(MARKER_SOURCE, "g"), "");
}

/** 把正文按引用标记切分为文本段与引用段。 */
export function parseAnswer(text: string): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  const regex = new RegExp(MARKER_SOURCE, "g");
  let cursor = 0;
  let order = 0;
  let match = regex.exec(text);

  while (match !== null) {
    if (match.index > cursor) {
      segments.push({ kind: "text", value: text.slice(cursor, match.index) });
    }
    order += 1;
    segments.push({ kind: "cite", label: match[1] ?? "", order });
    cursor = match.index + match[0].length;
    match = regex.exec(text);
  }

  if (cursor < text.length) {
    segments.push({ kind: "text", value: text.slice(cursor) });
  }
  return segments;
}

/** 点击角标的跳转目标：知识库详情页，并用 `doc` 参数定位到该文档。 */
function citationTarget(citation: Citation | undefined): string {
  if (citation === undefined) {
    return "/knowledge";
  }
  const scope =
    citation.knowledge_base_id === undefined
      ? "/knowledge"
      : `/knowledge/${encodeURIComponent(citation.knowledge_base_id)}`;
  return `${scope}?doc=${encodeURIComponent(citation.document_id)}`;
}

interface AnswerTextProps {
  text: string;
  citations: Citation[];
  /** 正文容器类名，默认沿用问答页的排版。 */
  className?: string;
}

export function AnswerText({ text, citations, className = "qa__answer-body" }: AnswerTextProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const navigate = useNavigate();

  const cancelScheduledClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelScheduledClose();
    closeTimerRef.current = window.setTimeout(() => {
      setActiveIndex(null);
      closeTimerRef.current = null;
    }, HOVER_CLOSE_DELAY_MS);
  }, [cancelScheduledClose]);

  // 组件卸载时清掉待执行的定时器，避免对已卸载组件 setState。
  useEffect(() => cancelScheduledClose, [cancelScheduledClose]);

  useEffect(() => {
    if (activeIndex === null) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setActiveIndex(null);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeIndex]);

  const byLabel = new Map<string, Citation>();
  for (const citation of citations) {
    byLabel.set(citation.label, citation);
  }

  return (
    <div className={className} ref={containerRef}>
      {parseAnswer(text).map((segment, index) => {
        if (segment.kind === "text") {
          return <span key={`text-${String(index)}`}>{segment.value}</span>;
        }

        const citation = byLabel.get(segment.label);
        const expanded = activeIndex === index;

        return (
          <span
            className="cite-wrap"
            key={`cite-${String(index)}-${segment.label}`}
            onMouseEnter={() => {
              cancelScheduledClose();
              setActiveIndex(index);
            }}
            onMouseLeave={scheduleClose}
          >
            <button
              type="button"
              className="cite"
              aria-expanded={expanded}
              aria-label={`第 ${String(segment.order)} 条条文来源：悬停查看，点击跳转到知识库`}
              onFocus={() => {
                cancelScheduledClose();
                setActiveIndex(index);
              }}
              onBlur={scheduleClose}
              onClick={() => {
                cancelScheduledClose();
                setActiveIndex(null);
                navigate(citationTarget(citation));
              }}
            >
              {segment.order}
            </button>
            {expanded ? (
              <CitationPopover
                citation={citation}
                onClose={() => {
                  cancelScheduledClose();
                  setActiveIndex(null);
                }}
              />
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
