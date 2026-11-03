import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  MarkdownText,
  parseMarkdownBlocks,
  stripMarkdown,
} from "../../src/components/MarkdownText";

describe("parseMarkdownBlocks", () => {
  it("把标题、列表与段落切成独立块", () => {
    const blocks = parseMarkdownBlocks("### 结论\n\n- 甲\n- 乙\n\n1. 一\n2. 二\n\n段落一\n段落二");

    expect(blocks).toEqual([
      { kind: "heading", level: 3, text: "结论" },
      { kind: "list", ordered: false, start: 1, items: ["甲", "乙"] },
      { kind: "list", ordered: true, start: 1, items: ["一", "二"] },
      { kind: "paragraph", text: "段落一段落二" },
    ]);
  });

  it("段落内的软换行按中文规则合并，不留下孤立标点行", () => {
    expect(parseMarkdownBlocks("合法权益[S1]\n。")).toEqual([
      { kind: "paragraph", text: "合法权益[S1]。" },
    ]);
    expect(parseMarkdownBlocks("DeepSeek\nAPI 文档")).toEqual([
      { kind: "paragraph", text: "DeepSeek API 文档" },
    ]);
  });

  it("合并连续引用行并识别分隔线", () => {
    expect(parseMarkdownBlocks("> 甲\n> 乙\n\n---")).toEqual([
      { kind: "quote", text: "甲\n乙" },
      { kind: "rule" },
    ]);
  });

  it("保留有序列表的起始序号", () => {
    expect(parseMarkdownBlocks("3. 丙\n4. 丁")).toEqual([
      { kind: "list", ordered: true, start: 3, items: ["丙", "丁"] },
    ]);
  });

  it("空正文得到空块列表", () => {
    expect(parseMarkdownBlocks("   \n\n")).toEqual([]);
  });
});

describe("MarkdownText", () => {
  it("标题与段落按顺序渲染", () => {
    render(<MarkdownText text={"### 结论\n\n未检索到足够依据。"} />);

    expect(screen.getByRole("heading", { level: 3, name: "结论" })).toBeInTheDocument();
    expect(screen.getByText("未检索到足够依据。")).toBeInTheDocument();
  });

  it("无序与有序列表分别渲染为 ul 与 ol", () => {
    const { container } = render(<MarkdownText text={"- 甲\n- 乙\n\n1. 丙\n2. 丁"} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(container.querySelector("ul")).not.toBeNull();
    expect(container.querySelector("ol")).not.toBeNull();
  });

  it("行内粗体、代码与链接不丢失文字", () => {
    render(<MarkdownText text={"**加粗**与`代码`与[链接](https://example.org/a)"} />);

    expect(screen.getByText("加粗").tagName).toBe("STRONG");
    expect(screen.getByText("代码").tagName).toBe("CODE");

    const link = screen.getByRole("link", { name: "链接" });
    expect(link).toHaveAttribute("href", "https://example.org/a");
    expect(link).toHaveAttribute("rel", "noreferrer noopener");
  });

  it("正文里的 HTML 只作为文本显示，不会被当成标签执行", () => {
    render(<MarkdownText text={"<img src=x onerror=alert(1)>"} />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
  });

  it("把引用标记交给调用方渲染，并保持列表结构", () => {
    render(
      <MarkdownText
        text={"- 甲[S1]乙\n- 丙"}
        renderCitation={(label, order) => (
          <button key={`${label}-${String(order)}`} type="button">
            {`来源${String(order)}`}
          </button>
        )}
      />,
    );

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("甲来源1乙");
    expect(screen.getByRole("button", { name: "来源1" })).toBeInTheDocument();
  });

  it("未提供渲染回调时标记按原文显示", () => {
    render(<MarkdownText text={"甲[S1]乙"} />);

    expect(screen.getByText("甲[S1]乙")).toBeInTheDocument();
  });

  it("标记出现在粗体内部时仍然渲染为角标", () => {
    const { container } = render(
      <MarkdownText
        text={"**甲[S1]乙**"}
        renderCitation={(label, order) => (
          <button key={`${label}-${String(order)}`} type="button">
            {`来源${String(order)}`}
          </button>
        )}
      />,
    );

    expect(screen.getByRole("button", { name: "来源1" })).toBeInTheDocument();

    const strong = container.querySelector("strong");
    expect(strong).not.toBeNull();
    const inner = strong?.textContent ?? "";
    expect(inner.startsWith("甲")).toBe(true);
    expect(inner.endsWith("乙")).toBe(true);
  });
});

describe("stripMarkdown", () => {
  it("去掉标题整行、列表前缀、粗体与引用标记", () => {
    expect(stripMarkdown("### 结论\n\n- **甲**应及时调回境内[S1]。\n- 乙。")).toBe(
      "甲应及时调回境内。\n乙。",
    );
  });

  it("链接只保留可见文字", () => {
    expect(stripMarkdown("详见[公开办法](https://example.org/a)。")).toBe("详见公开办法。");
  });

  it("引用块标记与行内代码同样被去掉", () => {
    expect(stripMarkdown("> 引用一句\n\n执行 `import_documents` 命令。")).toBe(
      "引用一句\n\n执行 import_documents 命令。",
    );
  });
});
