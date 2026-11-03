/**
 * 带条文角标的回答正文。
 *
 * 渲染分两层：{@link MarkdownText} 负责 Markdown 块与行内格式，
 * 本模块负责把 `[S1]` 标记变成可交互角标，并按设备能力决定交互：
 *
 * - **有悬停能力（桌面）**：悬停角标显示来源卡片，移开后延迟收起；点击角标直接
 *   跳转到该引用所属知识库的文档。
 * - **无悬停能力（触屏）**：点击角标展开来源卡片，卡片内「在知识库中查看」完成
 *   跳转。触屏没有 hover，若沿用桌面逻辑，点一下就跳走、卡片永远看不到。
 * - 键盘：聚焦角标同样显示卡片，`Esc` 收起。
 *
 * 同一引用标签可能在正文出现多次，展开状态按**出现序号**记录，
 * 否则同一标签的多个角标会同时弹出卡片。
 *
 * 若正文没有任何标记（后端尚未按契约输出），调用方应回退为普通 Markdown 正文
 * 加来源列表，因此本模块额外导出 `hasCitationMarkers` 供调用方判断。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { CitationPopover } from "./CitationPopover";
import { MarkdownText } from "./MarkdownText";
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

/**
 * 设备是否具备可靠的悬停能力。
 *
 * 无法判断（如测试环境没有 `matchMedia`）时按桌面处理，保持「悬停预览 + 点击跳转」。
 */
export function supportsHover(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }
  return window.matchMedia("(hover: hover)").matches;
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
  // order 用来区分同一标签的多个角标；alignRight 决定来源卡片朝哪一侧展开。
  const [active, setActive] = useState<{ order: number; alignRight: boolean } | null>(null);
  const [canHover] = useState(supportsHover);
  const closeTimerRef = useRef<number | null>(null);
  const navigate = useNavigate();

  const cancelScheduledClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    if (!canHover) {
      return;
    }
    cancelScheduledClose();
    closeTimerRef.current = window.setTimeout(() => {
      setActive(null);
      closeTimerRef.current = null;
    }, HOVER_CLOSE_DELAY_MS);
  }, [canHover, cancelScheduledClose]);

  // 组件卸载时清掉待执行的定时器，避免对已卸载组件 setState。
  useEffect(() => cancelScheduledClose, [cancelScheduledClose]);

  useEffect(() => {
    if (active === null) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setActive(null);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [active]);

  const byLabel = new Map<string, Citation>();
  const numberByLabel = new Map<string, number>();
  citations.forEach((citation, index) => {
    byLabel.set(citation.label, citation);
    numberByLabel.set(citation.label, index + 1);
  });

  const openCard = (order: number, element: HTMLElement): void => {
    cancelScheduledClose();
    const rect = element.getBoundingClientRect();
    setActive({ order, alignRight: rect.left + rect.width / 2 > window.innerWidth / 2 });
  };

  const closeCard = (): void => {
    cancelScheduledClose();
    setActive(null);
  };

  const renderCitation = (label: string, order: number, key: string) => {
    const citation = byLabel.get(label);
    const expanded = active?.order === order;
    // 后端返回 knowledge_base_id 时才能跳到知识库；真实数据暂未返回该字段时，
    // 点击角标改为展开来源卡片，避免跳到还没有接口的知识库页。
    const canJump = citation?.knowledge_base_id !== undefined;
    const hint = canJump
      ? canHover
        ? "悬停查看，点击跳转到知识库"
        : "点击查看条文来源"
      : "点击查看条文来源";
    // 角标数字跟随引用序号（S1 → 1），同一标签重复出现时显示同一个数字；
    // 找不到对应引用时退化为出现次序，避免角标没有编号。
    const number = numberByLabel.get(label) ?? order;

    return (
      <span
        className="cite-wrap"
        key={key}
        onMouseEnter={canHover ? (event) => openCard(order, event.currentTarget) : undefined}
        onMouseLeave={canHover ? scheduleClose : undefined}
      >
        <button
          type="button"
          className="cite"
          aria-expanded={expanded}
          aria-label={`第 ${String(number)} 条条文来源：${hint}`}
          onFocus={canHover ? (event) => openCard(order, event.currentTarget) : undefined}
          onBlur={canHover ? scheduleClose : undefined}
          onClick={(event) => {
            cancelScheduledClose();
            if (canHover) {
              if (canJump) {
                setActive(null);
                navigate(citationTarget(citation));
                return;
              }
              // 没有知识库可跳时，点击只是把卡片固定住（焦点已先打开卡片，不能再取反）。
              openCard(order, event.currentTarget);
              return;
            }
            if (expanded) {
              setActive(null);
            } else {
              openCard(order, event.currentTarget);
            }
          }}
        >
          {number}
        </button>
        {expanded ? (
          <CitationPopover
            citation={citation}
            alignRight={active?.alignRight ?? false}
            onClose={closeCard}
            onOpenDocument={
              canHover || !canJump
                ? undefined
                : () => {
                    setActive(null);
                    navigate(citationTarget(citation));
                  }
            }
          />
        ) : null}
      </span>
    );
  };

  return <MarkdownText className={className} text={text} renderCitation={renderCitation} />;
}
