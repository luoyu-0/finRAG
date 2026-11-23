import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentContentPage } from "../../src/features/documents/DocumentContentPage";
import type { DocumentContent } from "../../src/types/knowledge";

const { contentMock, ticketMock } = vi.hoisted(() => ({
  contentMock: vi.fn<(...args: unknown[]) => Promise<DocumentContent>>(),
  ticketMock: vi.fn<(...args: unknown[]) => Promise<{ url: string; expires_in: number }>>(),
}));

vi.mock("../../src/api/documents", () => ({
  getDocumentContent: (...args: unknown[]) => contentMock(...args),
  createDocumentFileTicket: (...args: unknown[]) => ticketMock(...args),
}));

vi.mock("../../src/api/knowledge", () => ({
  getKnowledgeBase: () => Promise.resolve({ id: "kb_001", name: "测试制度库" }),
}));

/**
 * pdf.js 依赖 Canvas/DOMMatrix，jsdom 无法真实渲染；这里用轻量替身验证——
 * 页面把票据、初始页与标题正确交给阅读器，由浏览器端负责真正的画布渲染。
 */
vi.mock("../../src/components/PdfViewer", () => ({
  PdfViewer: ({
    src,
    initialPage,
    title,
    onError,
  }: {
    src: string;
    initialPage?: number;
    title: string;
    onError: (message: string) => void;
  }) => (
    <div
      data-testid="pdf-viewer"
      data-src={src}
      data-page={String(initialPage ?? 1)}
      data-title={title}
    >
      <button type="button" onClick={() => onError("PDF 页面渲染失败。")}>
        模拟渲染失败
      </button>
    </div>
  ),
}));

const PDF_CONTENT: DocumentContent = {
  id: "doc_pdf",
  knowledge_base_id: "kb_001",
  title: "某银行制度汇编",
  file_name: "pdfs/某银行制度汇编.pdf",
  page_count: 42,
  policy_status: "active",
  source: "pdf",
  has_file: true,
  text: null,
  blocks: [],
  anchor: {
    chunk_id: "chunk_1",
    article_number: "第七条",
    page_number: 7,
    excerpt: "第七条 银行应当建立内部控制制度。",
    start: null,
    end: null,
    located: true,
  },
};

const FALLBACK_CONTENT: DocumentContent = {
  ...PDF_CONTENT,
  has_file: false,
  blocks: [
    {
      chunk_id: "chunk_1",
      article_number: "第七条",
      page_number: 7,
      text: "第七条 银行应当建立内部控制制度。",
    },
    {
      chunk_id: "chunk_2",
      article_number: null,
      page_number: 3,
      text: "编委会名单",
    },
  ],
};

function renderPage(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/documents/:documentId" element={<DocumentContentPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("文档正文页：PDF 渲染与返回位置", () => {
  beforeEach(() => {
    contentMock.mockReset();
    ticketMock.mockReset();
    ticketMock.mockResolvedValue({
      url: "/api/v1/documents/doc_pdf/file?token=abc",
      expires_in: 120,
    });
  });

  it("PDF 用页面内阅读器渲染，并直接定位到引用所在页", async () => {
    contentMock.mockResolvedValue(PDF_CONTENT);
    renderPage("/documents/doc_pdf?kb=kb_001&chunk=chunk_1&back=page%3D2");

    expect(await screen.findByRole("heading", { name: "PDF 原文" })).toBeInTheDocument();
    const viewer = await screen.findByTestId("pdf-viewer");
    expect(viewer).toHaveAttribute("data-src", "/api/v1/documents/doc_pdf/file?token=abc");
    expect(viewer).toHaveAttribute("data-page", "7");
    expect(viewer).toHaveAttribute("data-title", "某银行制度汇编");
    expect(screen.getByText(/打开时定位到第 7 页/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "引用原文" })).toBeInTheDocument();
    expect(screen.getByText("第七条 银行应当建立内部控制制度。")).toBeInTheDocument();
    // 浏览器插件方案已移除，不再出现 iframe。
    expect(screen.queryByTitle("某银行制度汇编 PDF 原文")).not.toBeInTheDocument();
  });

  it("没有引用页码时从第 1 页打开", async () => {
    contentMock.mockResolvedValue({
      ...PDF_CONTENT,
      anchor: null,
    });
    renderPage("/documents/doc_pdf?kb=kb_001&back=page%3D2");

    const viewer = await screen.findByTestId("pdf-viewer");
    expect(viewer).toHaveAttribute("data-page", "1");
    expect(screen.getByText(/打开时定位到第 1 页/)).toBeInTheDocument();
  });

  it("面包屑标出当前位置，返回链接带回列表页码与筛选", async () => {
    contentMock.mockResolvedValue(PDF_CONTENT);
    renderPage("/documents/doc_pdf?kb=kb_001&chunk=chunk_1&back=page%3D2");

    const breadcrumb = await screen.findByRole("navigation", { name: "面包屑" });
    expect(breadcrumb).toHaveTextContent("知识库");
    expect(breadcrumb).toHaveTextContent("测试制度库");
    expect(breadcrumb).toHaveTextContent("某银行制度汇编");

    const back = screen.getByRole("link", { name: "返回知识库" });
    expect(back).toHaveAttribute("href", "/knowledge/kb_001?page=2");
  });

  it("换票失败时显示分块，重试重新签发票据", async () => {
    const user = userEvent.setup();
    contentMock.mockResolvedValue({ ...FALLBACK_CONTENT, has_file: true });
    ticketMock.mockRejectedValueOnce(new Error("签票失败"));
    renderPage("/documents/doc_pdf?kb=kb_001&chunk=chunk_1");

    expect(await screen.findByRole("heading", { name: "分块摘录" })).toBeInTheDocument();
    expect(screen.getByText("编委会名单")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByTestId("pdf-viewer")).toBeInTheDocument();
    expect(ticketMock).toHaveBeenCalledTimes(2);
  });

  it("渲染失败时显示分块，重试使用新链接", async () => {
    const user = userEvent.setup();
    contentMock.mockResolvedValue({ ...FALLBACK_CONTENT, has_file: true });
    renderPage("/documents/doc_pdf?kb=kb_001&chunk=chunk_1");

    await user.click(await screen.findByRole("button", { name: "模拟渲染失败" }));
    expect(await screen.findByRole("heading", { name: "分块摘录" })).toBeInTheDocument();
    expect(screen.getByText("引用位置")).toBeInTheDocument();
    ticketMock.mockResolvedValueOnce({
      url: "/api/v1/documents/doc_pdf/file?token=new",
      expires_in: 120,
    });
    await user.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByTestId("pdf-viewer")).toHaveAttribute(
      "data-src",
      "/api/v1/documents/doc_pdf/file?token=new",
    );
  });

  it("从引用角标进入的文档返回来源定位", async () => {
    contentMock.mockResolvedValue(FALLBACK_CONTENT);
    renderPage("/documents/doc_pdf?kb=kb_001&chunk=chunk_1");

    expect(await screen.findByRole("link", { name: "返回知识库" })).toHaveAttribute(
      "href",
      "/knowledge/kb_001?doc=doc_pdf",
    );
  });

  it("原文不可渲染时退回按页展示的分块摘录", async () => {
    contentMock.mockResolvedValue(FALLBACK_CONTENT);
    renderPage("/documents/doc_pdf?kb=kb_001&chunk=chunk_1");

    expect(await screen.findByRole("heading", { name: "分块摘录" })).toBeInTheDocument();
    expect(screen.queryByTitle("某银行制度汇编 PDF 原文")).not.toBeInTheDocument();
    expect(screen.getByText("第七条 银行应当建立内部控制制度。")).toBeInTheDocument();
    expect(screen.getByText("编委会名单")).toBeInTheDocument();
    expect(screen.getByText("引用位置")).toBeInTheDocument();
  });
});
