import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CitationList } from "../../src/components/CitationList";
import type { Citation } from "../../src/types/qa";

const BASE: Citation = {
  label: "S1",
  document_id: "doc_001",
  version_id: "ver_001",
  chunk_id: "chunk_001",
  title: "商业银行流动性风险管理办法（示例）",
  page_number: 12,
  article_number: "第二十条",
  source_url: null,
};

describe("CitationList", () => {
  it("展示条款编号、页码与分块标识", () => {
    render(<CitationList citations={[BASE]} />);

    expect(screen.getByText("[S1]")).toBeInTheDocument();
    expect(screen.getByText("商业银行流动性风险管理办法（示例）")).toBeInTheDocument();
    expect(screen.getByText("第二十条")).toBeInTheDocument();
    expect(screen.getByText("第 12 页")).toBeInTheDocument();
    expect(screen.getByText("分块 chunk_001")).toBeInTheDocument();
  });

  it("缺少页码与条文编号时只展示已有字段", () => {
    render(
      <CitationList
        citations={[{ ...BASE, page_number: null, article_number: null, chunk_id: "chunk_002" }]}
      />,
    );

    expect(screen.queryByText(/第 \d+ 页/)).not.toBeInTheDocument();
    expect(screen.getByText("分块 chunk_002")).toBeInTheDocument();
  });

  it("没有引用时给出明确提示", () => {
    render(<CitationList citations={[]} />);

    expect(screen.getByText("本次回答没有引用任何制度条文。")).toBeInTheDocument();
  });

  it("存在来源链接时渲染外链", () => {
    render(
      <CitationList citations={[{ ...BASE, source_url: "https://example.org/policy.pdf" }]} />,
    );

    expect(screen.getByRole("link", { name: "查看原文" })).toHaveAttribute(
      "href",
      "https://example.org/policy.pdf",
    );
  });
});
