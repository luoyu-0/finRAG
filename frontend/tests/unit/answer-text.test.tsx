import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import {
  AnswerText,
  hasCitationMarkers,
  parseAnswer,
  stripCitationMarkers,
} from "../../src/components/AnswerText";
import type { Citation } from "../../src/types/qa";

const CITATIONS: Citation[] = [
  {
    label: "S1",
    knowledge_base_id: "kb_1",
    document_id: "doc_1",
    version_id: "ver_1",
    chunk_id: "chunk_1",
    title: "制度甲（示例）",
    page_number: 12,
    article_number: "第二十条",
    source_url: null,
    excerpt: "示例原文摘录甲。",
  },
  {
    label: "S2",
    knowledge_base_id: "kb_2",
    document_id: "doc_2",
    version_id: "ver_2",
    chunk_id: "chunk_2",
    title: "制度乙（示例）",
    page_number: null,
    article_number: null,
    source_url: "https://example.org/policy.pdf",
  },
];

function renderText(text: string, citations: Citation[] = CITATIONS) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<AnswerText text={text} citations={citations} />} />
        <Route path="/knowledge" element={<p>知识库列表页</p>} />
        <Route path="/knowledge/:knowledgeBaseId" element={<p>知识库详情页</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("引用标记解析", () => {
  it("识别正文是否包含标记", () => {
    expect(hasCitationMarkers("有引用[S1]。")).toBe(true);
    expect(hasCitationMarkers("没有任何引用。")).toBe(false);
  });

  it("按标记切分为文本段与引用段", () => {
    const segments = parseAnswer("甲[S1]乙[S2]丙");

    expect(segments).toHaveLength(5);
    expect(segments[0]).toEqual({ kind: "text", value: "甲" });
    expect(segments[1]).toEqual({ kind: "cite", label: "S1", order: 1 });
    expect(segments[3]).toEqual({ kind: "cite", label: "S2", order: 2 });
    expect(segments[4]).toEqual({ kind: "text", value: "丙" });
  });

  it("去掉标记后用于列表摘要", () => {
    expect(stripCitationMarkers("甲[S1]乙[S2]")).toBe("甲乙");
  });
});

describe("AnswerText", () => {
  it("把标记渲染为角标并给出 aria-expanded", () => {
    renderText("甲[S1]乙");

    expect(screen.getByRole("button", { name: /第 1 条条文来源/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("悬停角标即显示来源卡片，移开后收起", async () => {
    const user = userEvent.setup();
    renderText("甲[S1]乙");
    const anchor = screen.getByRole("button", { name: /第 1 条条文来源/ });

    expect(screen.queryByText("制度甲（示例）")).not.toBeInTheDocument();

    await user.hover(anchor);
    expect(await screen.findByText("制度甲（示例）")).toBeInTheDocument();
    expect(screen.getByText("第二十条")).toBeInTheDocument();
    expect(screen.getByText("第 12 页")).toBeInTheDocument();
    expect(screen.getByText("示例原文摘录甲。")).toBeInTheDocument();

    await user.unhover(anchor);
    await waitFor(() => {
      expect(screen.queryByText("制度甲（示例）")).not.toBeInTheDocument();
    });
  });

  it("按 Esc 关闭来源卡片", async () => {
    const user = userEvent.setup();
    renderText("甲[S1]乙");

    await user.hover(screen.getByRole("button", { name: /第 1 条条文来源/ }));
    expect(await screen.findByText("制度甲（示例）")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByText("制度甲（示例）")).not.toBeInTheDocument();
    });
  });

  it("点击角标跳转到该引用所属的知识库详情页", async () => {
    const user = userEvent.setup();
    renderText("甲[S1]乙");

    await user.click(screen.getByRole("button", { name: /第 1 条条文来源/ }));

    expect(await screen.findByText("知识库详情页")).toBeInTheDocument();
  });

  it("引用缺少知识库标识时点击退化为知识库列表页", async () => {
    const user = userEvent.setup();
    const noScope: Citation[] = [{ ...CITATIONS[0], knowledge_base_id: undefined }];
    renderText("甲[S1]乙", noScope);

    await user.click(screen.getByRole("button", { name: /第 1 条条文来源/ }));

    expect(await screen.findByText("知识库列表页")).toBeInTheDocument();
  });

  it("缺少摘录与页码时不渲染对应字段，有来源链接时渲染外链", async () => {
    const user = userEvent.setup();
    renderText("甲[S2]乙");

    await user.hover(screen.getByRole("button", { name: /第 1 条条文来源/ }));

    expect(await screen.findByText("制度乙（示例）")).toBeInTheDocument();
    expect(screen.getByText("分块 chunk_2")).toBeInTheDocument();
    expect(screen.queryByText(/第 \d+ 页/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看原文" })).toHaveAttribute(
      "href",
      "https://example.org/policy.pdf",
    );
  });

  it("标记找不到对应引用时只渲染角标，不报错", async () => {
    const user = userEvent.setup();
    renderText("甲[S9]乙");

    const anchor = screen.getByRole("button", { name: /第 1 条条文来源/ });
    await user.hover(anchor);
    expect(screen.queryByText("制度甲（示例）")).not.toBeInTheDocument();

    await user.click(anchor);
    expect(await screen.findByText("知识库列表页")).toBeInTheDocument();
  });
});
