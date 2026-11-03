import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

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

/**
 * 模拟设备的悬停能力。测试环境（jsdom）没有 `matchMedia`，
 * 默认会被判定为桌面端，因此触屏用例需要显式声明。
 */
function stubHoverCapability(hasHover: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) =>
      ({
        matches: hasHover,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
});

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

  it("引用缺少知识库标识时点击展开来源卡片，不跳转到空页面", async () => {
    const user = userEvent.setup();
    const noScope: Citation[] = [{ ...CITATIONS[0], knowledge_base_id: undefined }];
    renderText("甲[S1]乙", noScope);

    await user.click(screen.getByRole("button", { name: /第 1 条条文来源/ }));

    // 真实数据尚未返回 knowledge_base_id 时，跳不到知识库页，改为就地展示来源
    expect(await screen.findByText("制度甲（示例）")).toBeInTheDocument();
    expect(screen.queryByText("知识库列表页")).not.toBeInTheDocument();
  });

  it("缺少摘录与页码时不渲染对应字段，有来源链接时渲染外链", async () => {
    const user = userEvent.setup();
    renderText("甲[S2]乙");

    // 角标编号跟随引用序号：S2 是第二条引用，因此显示「第 2 条」。
    await user.hover(screen.getByRole("button", { name: /第 2 条条文来源/ }));

    expect(await screen.findByText("制度乙（示例）")).toBeInTheDocument();
    expect(screen.getByText("分块 chunk_2")).toBeInTheDocument();
    expect(screen.queryByText(/第 \d+ 页/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看原文" })).toHaveAttribute(
      "href",
      "https://example.org/policy.pdf",
    );
  });

  it("标记找不到对应引用时只渲染角标，不跳转也不报错", async () => {
    const user = userEvent.setup();
    renderText("甲[S9]乙");

    const anchor = screen.getByRole("button", { name: /第 1 条条文来源/ });
    await user.hover(anchor);
    expect(screen.queryByText("制度甲（示例）")).not.toBeInTheDocument();

    await user.click(anchor);
    expect(screen.queryByText("知识库列表页")).not.toBeInTheDocument();
    expect(screen.queryByText("知识库详情页")).not.toBeInTheDocument();
  });
});

describe("Markdown 正文", () => {
  it("按 Markdown 渲染标题与列表，角标保留在列表项内", () => {
    renderText("### 结论\n\n- 募集资金应及时调回境内[S1]。\n- 留存境外的应取得批复。");

    expect(screen.getByRole("heading", { level: 3, name: "结论" })).toBeInTheDocument();
    const firstItem = screen.getAllByRole("listitem")[0];
    expect(firstItem).toHaveTextContent("募集资金应及时调回境内");
    expect(within(firstItem).getByRole("button", { name: /第 1 条条文来源/ })).toBeInTheDocument();
  });

  it("没有列表语法时只渲染段落", () => {
    const { container } = renderText("### 结论\n\n一句话回答。");

    expect(container.querySelectorAll("p")).toHaveLength(1);
  });
});

describe("触屏交互", () => {
  it("点击角标先展开来源卡片，不直接跳转", async () => {
    stubHoverCapability(false);
    const user = userEvent.setup();
    renderText("甲[S1]乙");

    await user.click(screen.getByRole("button", { name: /第 1 条条文来源/ }));

    expect(await screen.findByText("制度甲（示例）")).toBeInTheDocument();
    expect(screen.queryByText("知识库详情页")).not.toBeInTheDocument();
  });

  it("再次点击角标收起卡片", async () => {
    stubHoverCapability(false);
    const user = userEvent.setup();
    renderText("甲[S1]乙");
    const anchor = screen.getByRole("button", { name: /第 1 条条文来源/ });

    await user.click(anchor);
    expect(await screen.findByText("制度甲（示例）")).toBeInTheDocument();

    await user.click(anchor);
    await waitFor(() => {
      expect(screen.queryByText("制度甲（示例）")).not.toBeInTheDocument();
    });
  });

  it("卡片内的「在知识库中查看」完成跳转", async () => {
    stubHoverCapability(false);
    const user = userEvent.setup();
    renderText("甲[S1]乙");

    await user.click(screen.getByRole("button", { name: /第 1 条条文来源/ }));
    await user.click(await screen.findByRole("button", { name: "在知识库中查看" }));

    expect(await screen.findByText("知识库详情页")).toBeInTheDocument();
  });

  it("桌面端卡片不出现跳转按钮", async () => {
    const user = userEvent.setup();
    renderText("甲[S1]乙");

    await user.hover(screen.getByRole("button", { name: /第 1 条条文来源/ }));

    expect(await screen.findByText("制度甲（示例）")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "在知识库中查看" })).not.toBeInTheDocument();
  });
});

describe("角标编号", () => {
  it("同一标签重复出现时显示同一个编号", () => {
    renderText("甲[S1]乙[S1]丙[S2]");

    const badges = screen.getAllByRole("button", { name: /条条文来源/ });
    expect(badges.map((badge) => badge.textContent)).toEqual(["1", "1", "2"]);
  });
});

describe("真实后端的引用形态", () => {
  const REAL: Citation[] = [
    {
      label: "S1",
      knowledge_base_id: "default",
      document_id: "8f1c9a5e2d4b7c3a6e0f1b8d2c9a4e7f",
      version_id: "b2e4c6a8d0f1b3c5e7a9d2f4b6c8e0a1",
      chunk_id: "2f6d8a1c4b7e9f03d5a6c8e1b4f7a2d9",
      title: "中华人民共和国反洗钱法",
      page_number: 3,
      article_number: "第四条",
      source_url: null,
      excerpt: "反洗钱工作应当依法进行，确保反洗钱措施与洗钱风险相适应。",
    },
  ];

  it("展示后端返回的原文摘录，并缩写长分块 ID", async () => {
    const user = userEvent.setup();
    renderText("### 结论\n\n反洗钱措施应与洗钱风险相适应[S1]。", REAL);

    await user.hover(screen.getByRole("button", { name: /第 1 条条文来源/ }));

    expect(await screen.findByText("中华人民共和国反洗钱法")).toBeInTheDocument();
    expect(screen.getByText("第四条")).toBeInTheDocument();
    expect(screen.getByText("第 3 页")).toBeInTheDocument();
    expect(screen.getByText("分块 2f6d8a1c…")).toBeInTheDocument();
    expect(screen.getByText(/反洗钱工作应当依法进行/)).toBeInTheDocument();
  });
});
