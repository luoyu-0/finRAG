/**
 * 带条文角标的回答正文。
 *
 * 契约 §6 要求后端在 `answer` 的引用位置内嵌 `[S1]`、`[S2]` 形式的标签。
 * 前端据此渲染为可点击的上标角标；点击后在角标旁弹出小卡片展示该条来源。
 *
 * 注意：同一引用标签可能在正文出现多次，因此展开状态用**段落下标**标识，
 * 而不是标签本身，否则同一标签的多个角标会同时弹出卡片。
 *
 * 若正文没有任何标记（后端尚未按契约输出），调用方应回退为纯文本 + 来源列表，
 * 因此本模块额外导出 `hasCitationMarkers` 供调用方判断。
 */
import { useEffect, useRef, useState } from "react";

import { CitationPopover } from "./CitationPopover";
import type { Citation } from "../types/qa";

export type AnswerSegment =
  { kind: "text"; value: string } | { kind: "cite"; label: string; order: number };

const MARKER_PATTERN = /\[(S\d+)\]/;
const MARKER_SOURCE = "\\[(S\\d+)\\]";

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

interface AnswerTextProps {
  text: string;
  citations: Citation[];
  /** 正文容器类名，默认沿用问答页的排版。 */
  className?: string;
}

export function AnswerText({ text, citations, className = "qa__answer-body" }: AnswerTextProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeIndex === null) {
      return;
    }

    function handlePointerDown(event: MouseEvent): void {
      if (containerRef.current !== null && !containerRef.current.contains(event.target as Node)) {
        setActiveIndex(null);
      }
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setActiveIndex(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
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

        const expanded = activeIndex === index;
        return (
          <span className="cite-wrap" key={`cite-${String(index)}-${segment.label}`}>
            <button
              type="button"
              className="cite"
              aria-expanded={expanded}
              aria-label={`查看第 ${String(segment.order)} 条条文来源`}
              onClick={() => setActiveIndex(expanded ? null : index)}
            >
              {segment.order}
            </button>
            {expanded ? (
              <CitationPopover
                citation={byLabel.get(segment.label)}
                onClose={() => setActiveIndex(null)}
              />
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
