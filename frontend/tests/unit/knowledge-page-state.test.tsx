import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { KnowledgeDetailPage } from "../../src/features/knowledge/KnowledgeDetailPage";
import { AuthProvider } from "../../src/stores/auth";
import type { Page } from "../../src/types/api";
import type { DocumentSummary } from "../../src/types/knowledge";

/** 60 份文档，保证分页可用；换页时用的是「下一页」按钮。 */
function makeDocuments(): DocumentSummary[] {
  return Array.from({ length: 60 }, (_, index) => {
    const seq = index + 1;
    return {
      id: `doc_${String(seq).padStart(3, "0")}`,
      knowledge_base_id: "kb_001",
      title: `制度文档 ${String(seq)}`,
      file_name: `txts/制度文档${String(seq)}.txt`,
      file_size: 2048,
      page_count: 3,
      source_url: null,
      tags: [],
      version_count: 1,
      current_version: {
        id: `ver_${String(seq)}`,
        policy_status: "active",
        effective_from: null,
        effective_to: null,
      },
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-02T00:00:00Z",
    } satisfies DocumentSummary;
  });
}

const DOCUMENTS = makeDocuments();

async function pageOfDocuments(
  _client: unknown,
  query?: { page?: number },
): Promise<Page<DocumentSummary>> {
  const page = query?.page ?? 1;
  const start = (page - 1) * 50;
  return {
    items: DOCUMENTS.slice(start, start + 50),
    page,
    page_size: 50,
    total: DOCUMENTS.length,
    has_next: start + 50 < DOCUMENTS.length,
  };
}

const listDocumentsMock = vi.fn<typeof pageOfDocuments>(pageOfDocuments);

vi.mock("../../src/api/documents", () => ({
  listDocuments: (client: unknown, query?: { page?: number }) => listDocumentsMock(client, query),
  listDocumentCategories: () => Promise.resolve([]),
  getDocument: () => Promise.resolve(null),
  getDocumentContent: () => Promise.resolve(null),
  createDocumentFileTicket: () => Promise.resolve({ url: "", expires_in: 0 }),
}));

vi.mock("../../src/api/knowledge", () => ({
  getKnowledgeBase: () =>
    Promise.resolve({
      id: "kb_001",
      name: "测试制度库",
      description: "用于分页与返回位置测试",
      document_count: 60,
      chunk_count: 600,
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-02T00:00:00Z",
    }),
  getKnowledgeBaseStats: () =>
    Promise.resolve({
      knowledge_base_id: "kb_001",
      document_count: 60,
      version_count: 60,
      chunk_count: 600,
      active_version_count: 60,
      inactive_version_count: 0,
      embedded_chunk_count: 600,
      pending_chunk_count: 0,
      parse_warning_count: 0,
      last_ingested_at: "2026-11-02T00:00:00Z",
    }),
  updateKnowledgeBase: () => Promise.reject(new Error("not used")),
}));

function renderDetail(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <AuthProvider>
        <Routes>
          <Route path="/knowledge/:knowledgeBaseId" element={<KnowledgeDetailPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("知识库详情页：分页与返回位置", () => {
  beforeEach(() => {
    listDocumentsMock.mockReset();
    listDocumentsMock.mockImplementation(pageOfDocuments);
  });

  it("换页只更新文档表，头部与导入健康度不进入整页加载态", async () => {
    const user = userEvent.setup();
    renderDetail("/knowledge/kb_001");

    expect(await screen.findByText("制度文档 1")).toBeInTheDocument();
    expect(screen.getByText("导入健康度")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "下一页" }));

    // 请求尚未返回时保留页头与统计卡片，而不是整块替换成加载态。
    expect(screen.queryByText("正在加载知识库…")).not.toBeInTheDocument();
    expect(screen.getByText("导入健康度")).toBeInTheDocument();
    expect(await screen.findByText("制度文档 51")).toBeInTheDocument();
  });

  it("文档标题链接携带知识库与列表查询串，便于返回原来的页码与筛选", async () => {
    renderDetail("/knowledge/kb_001?page=2&sort=title&order=asc&q=制度");

    const link = await screen.findByRole("link", { name: "制度文档 51" });
    const url = new URL(link.getAttribute("href") ?? "", "http://localhost");
    expect(url.pathname).toBe("/documents/doc_051");
    expect(url.searchParams.get("kb")).toBe("kb_001");
    expect(url.searchParams.get("back")).toBe("page=2&sort=title&order=asc&q=%E5%88%B6%E5%BA%A6");
  });

  it("换页失败时保留已有表格并给出可重试的提示", async () => {
    const user = userEvent.setup();
    renderDetail("/knowledge/kb_001");

    expect(await screen.findByText("制度文档 1")).toBeInTheDocument();
    listDocumentsMock.mockRejectedValueOnce(new Error("网络错误"));

    await user.click(screen.getByRole("button", { name: "下一页" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("文档列表更新失败");
    expect(screen.getByText("制度文档 1")).toBeInTheDocument();
  });
});
