/**
 * 回答正文的 Markdown 渲染。
 *
 * 契约（docs/api/系统接口.md §6）规定 `answer` 是可直接渲染的简体中文 Markdown：
 * 以 `###` 小标题开头，多项规定用列表表达，引用标记 `[S1]` 内嵌在正文中。
 * 因此这里需要同时完成两件事：按块渲染 Markdown，并把行内引用标记交给调用方
 * 渲染成可交互角标。
 *
 * 设计取舍：
 * - 不引入 Markdown 依赖，只实现后端实际会输出的子集（标题、列表、引用块、
 *   分隔线、段落，以及 **粗体**、`行内代码`、[链接](url)）。其余语法按普通
 *   文本输出，不会报错，也不会吞掉内容。
 * - 全程输出 React 节点，不拼接 HTML 字符串，模型输出里的标签只会作为文本显示。
 * - **先按行切块，再在块内解析行内语法**。若先按 `[S1]` 切分再各自渲染，
 *   `- 募集资金应及时调回境内[S1]。` 会被切成两个段落，列表结构就断了。
 */

import type { ReactNode } from "react";

export type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "rule" };

/** 把正文里的 `[S1]` 渲染成角标；由调用方决定交互与跳转。 */
export type RenderCitation = (label: string, order: number, key: string) => ReactNode;

const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*$/;
const BULLET_PATTERN = /^\s{0,3}[-*+]\s+(.+?)\s*$/;
const ORDERED_PATTERN = /^\s{0,3}(\d{1,3})[.)]\s+(.+?)\s*$/;
const QUOTE_PATTERN = /^\s{0,3}>\s?(.*)$/;
const RULE_PATTERN = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;

/** 行内语法；`y` 让正则从 lastIndex 处开始匹配，便于逐字符扫描。 */
const CITATION_PATTERN = /\[(S\d+)\]/y;
const BOLD_PATTERN = /\*\*(?=\S)([\s\S]*?\S)\*\*/y;
const CODE_PATTERN = /`([^`\n]+)`/y;
const LINK_PATTERN = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/y;

/** 中日韩字符与全角标点，用于判断软换行两侧是否需要补空格。 */
const CJK_PATTERN = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/;

/**
 * 合并段落内的软换行。
 *
 * Markdown 里段内换行等价于空格；中文之间不补空格，西文之间补一个。
 * 模型偶尔把句号单独换到下一行，若直接交给 `pre-wrap` 会渲染成一个孤立的标点行。
 */
function joinSoftLines(lines: string[]): string {
  return lines.reduce((text, line) => {
    if (text === "") {
      return line;
    }
    const previous = text.slice(-1);
    const next = line.slice(0, 1);
    const needsSpace = !CJK_PATTERN.test(previous) && !CJK_PATTERN.test(next);
    return text + (needsSpace ? " " : "") + line;
  }, "");
}

/**
 * 把 Markdown 源码切成块。
 *
 * 连续的无序/有序列表项会合并到同一个列表；连续的引用行合并为一个引用块；
 * 连续的非空行合并为一个段落。
 */
export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: joinSoftLines(paragraph) });
      paragraph = [];
    }
  };

  const lastBlock = (): MarkdownBlock | undefined => blocks[blocks.length - 1];
  const pushListItem = (ordered: boolean, start: number, item: string): void => {
    flushParagraph();
    const previous = lastBlock();
    if (previous?.kind === "list" && previous.ordered === ordered) {
      previous.items.push(item);
      return;
    }
    blocks.push({ kind: "list", ordered, start, items: [item] });
  };

  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }

    if (RULE_PATTERN.test(line)) {
      flushParagraph();
      blocks.push({ kind: "rule" });
      continue;
    }

    const heading = HEADING_PATTERN.exec(line);
    if (heading !== null) {
      flushParagraph();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }

    const bullet = BULLET_PATTERN.exec(line);
    if (bullet !== null) {
      pushListItem(false, 1, bullet[1]);
      continue;
    }

    const ordered = ORDERED_PATTERN.exec(line);
    if (ordered !== null) {
      pushListItem(true, Number(ordered[1]), ordered[2]);
      continue;
    }

    const quote = QUOTE_PATTERN.exec(line);
    if (quote !== null) {
      flushParagraph();
      const previous = lastBlock();
      if (previous?.kind === "quote") {
        previous.text = `${previous.text}\n${quote[1]}`;
      } else {
        blocks.push({ kind: "quote", text: quote[1] });
      }
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  return blocks;
}

function renderInline(
  text: string,
  keyPrefix: string,
  renderCitation: RenderCitation | undefined,
  nextOrder: () => number,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let buffer = "";
  let index = 0;

  const flushBuffer = (): void => {
    if (buffer !== "") {
      nodes.push(buffer);
      buffer = "";
    }
  };

  while (index < text.length) {
    if (renderCitation !== undefined) {
      CITATION_PATTERN.lastIndex = index;
      const citation = CITATION_PATTERN.exec(text);
      if (citation !== null) {
        // 先取出匹配末尾再递归/回调：它们会改写同一批 sticky 正则的 lastIndex。
        const end = CITATION_PATTERN.lastIndex;
        flushBuffer();
        const order = nextOrder();
        nodes.push(renderCitation(citation[1], order, `${keyPrefix}-c${String(order)}`));
        index = end;
        continue;
      }
    }

    BOLD_PATTERN.lastIndex = index;
    const bold = BOLD_PATTERN.exec(text);
    if (bold !== null) {
      const end = BOLD_PATTERN.lastIndex;
      flushBuffer();
      const key = `${keyPrefix}-b${String(nodes.length)}`;
      nodes.push(
        <strong key={key}>{renderInline(bold[1], key, renderCitation, nextOrder)}</strong>,
      );
      index = end;
      continue;
    }

    CODE_PATTERN.lastIndex = index;
    const code = CODE_PATTERN.exec(text);
    if (code !== null) {
      const end = CODE_PATTERN.lastIndex;
      flushBuffer();
      nodes.push(<code key={`${keyPrefix}-code${String(nodes.length)}`}>{code[1]}</code>);
      index = end;
      continue;
    }

    LINK_PATTERN.lastIndex = index;
    const link = LINK_PATTERN.exec(text);
    if (link !== null) {
      const end = LINK_PATTERN.lastIndex;
      flushBuffer();
      const key = `${keyPrefix}-a${String(nodes.length)}`;
      nodes.push(
        <a key={key} href={link[2]} target="_blank" rel="noreferrer noopener">
          {renderInline(link[1], key, renderCitation, nextOrder)}
        </a>,
      );
      index = end;
      continue;
    }

    buffer += text[index];
    index += 1;
  }

  flushBuffer();
  return nodes;
}

const HEADING_TAGS = ["h3", "h4", "h5", "h6"] as const;

function headingTag(level: number): (typeof HEADING_TAGS)[number] {
  // 页面自身已有 h1/h2（品牌区与卡片标题），正文标题最高从 h3 起，避免层级跳跃。
  const shift = Math.min(Math.max(level - 3, 0), HEADING_TAGS.length - 1);
  return HEADING_TAGS[shift];
}

interface MarkdownTextProps {
  text: string;
  className?: string;
  /** 提供时，正文里的 `[S1]` 交给它渲染；不提供则原样显示 `[S1]`。 */
  renderCitation?: RenderCitation;
}

export function MarkdownText({ text, className, renderCitation }: MarkdownTextProps) {
  const blocks = parseMarkdownBlocks(text);

  return (
    <div className={className === undefined ? "md" : `md ${className}`}>
      {renderBlocks(blocks, renderCitation)}
    </div>
  );
}

/**
 * 渲染块列表。
 *
 * 引用序号在这一次渲染过程中按出现顺序递增（同一标签出现多次时各自编号，
 * 与角标上显示的数字一致）。计数只存在于本次调用内部，不跨渲染保留。
 */
function renderBlocks(
  blocks: MarkdownBlock[],
  renderCitation: RenderCitation | undefined,
): ReactNode[] {
  let order = 0;
  const nextOrder = (): number => {
    order += 1;
    return order;
  };

  const render = (value: string, keyPrefix: string): ReactNode[] =>
    renderInline(value, keyPrefix, renderCitation, nextOrder);

  return blocks.map((block, blockIndex) => {
    const key = `b${String(blockIndex)}`;
    switch (block.kind) {
      case "heading": {
        const Heading = headingTag(block.level);
        return (
          <Heading className="md__heading" key={key}>
            {render(block.text, key)}
          </Heading>
        );
      }
      case "paragraph":
        return (
          <p className="md__paragraph" key={key}>
            {render(block.text, key)}
          </p>
        );
      case "list": {
        const List = block.ordered ? "ol" : "ul";
        return (
          <List className="md__list" key={key} start={block.ordered ? block.start : undefined}>
            {block.items.map((item, itemIndex) => {
              const itemKey = `${key}-i${String(itemIndex)}`;
              return (
                <li className="md__item" key={itemKey}>
                  {render(item, itemKey)}
                </li>
              );
            })}
          </List>
        );
      }
      case "quote":
        return (
          <blockquote className="md__quote" key={key}>
            {render(block.text, key)}
          </blockquote>
        );
      case "rule":
        return <hr className="md__rule" key={key} />;
    }
  });
}

/**
 * 去掉 Markdown 语法与引用标记，得到适合列表摘要的纯文本。
 *
 * 小标题整行去掉：它只是分段标签（如「结论」「具体规定」），留在摘要里会像正文。
 * 只用于摘要、`title` 之类不能带格式的位置；正文渲染请用 {@link MarkdownText}。
 */
export function stripMarkdown(source: string): string {
  return (
    source
      .replace(/\r\n?/g, "\n")
      .replace(/```[\s\S]*?```/g, "")
      // 只消费行内的空格与制表符：`\s` 会连换行一起吃掉，把空行合并掉。
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+.*$/gm, "")
      .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
      .replace(/^[ \t]{0,3}(?:[-*+]|\d{1,3}[.)])[ \t]+/gm, "")
      .replace(/^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, "")
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "$1")
      .replace(/`([^`\n]+)`/g, "$1")
      .replace(/\[([^\]\n]+)\]\((?:https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, "$1")
      .replace(/\[(S\d+)\]/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
