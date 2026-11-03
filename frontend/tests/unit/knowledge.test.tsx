import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { KnowledgeDetailPage } from "../../src/features/knowledge/KnowledgeDetailPage";
import { KnowledgePage } from "../../src/features/knowledge/KnowledgePage";
import { AuthProvider } from "../../src/stores/auth";

function renderRoute(element: ReactNode, path: string, initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <AuthProvider>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("知识库列表页", () => {
  it("展示演示数据中的知识库及其统计", async () => {
    renderRoute(<KnowledgePage />, "/knowledge", "/knowledge");

    expect(await screen.findByText("金融监管制度库")).toBeInTheDocument();
    expect(screen.getByText("支付与征信专题库")).toBeInTheDocument();
    // 含真实语料知识库「人民银行公开制度库」
    expect(screen.getByText("人民银行公开制度库")).toBeInTheDocument();
    expect(screen.getByText("共 3 个")).toBeInTheDocument();
  });

  it("搜索无匹配时给出空状态提示", async () => {
    const user = userEvent.setup();
    renderRoute(<KnowledgePage />, "/knowledge", "/knowledge");
    await screen.findByText("金融监管制度库");

    await user.type(screen.getByLabelText("搜索知识库"), "不存在的关键字");
    await user.click(screen.getByRole("button", { name: "搜索" }));

    expect(await screen.findByText("没有匹配的知识库")).toBeInTheDocument();
  });

  it("知识库名称是指向详情页的链接", async () => {
    renderRoute(<KnowledgePage />, "/knowledge", "/knowledge");

    const link = await screen.findByRole("link", { name: "金融监管制度库" });
    expect(link).toHaveAttribute("href", "/knowledge/kb_001");
  });
});

describe("知识库详情页", () => {
  it("展示导入健康度与文档列表", async () => {
    renderRoute(<KnowledgeDetailPage />, "/knowledge/:knowledgeBaseId", "/knowledge/kb_001");

    expect(await screen.findByRole("heading", { name: "金融监管制度库" })).toBeInTheDocument();
    expect(screen.getByText("导入健康度")).toBeInTheDocument();
    expect(screen.getByText("商业银行流动性风险管理办法（示例）")).toBeInTheDocument();
    expect(screen.getByText("共 5 份")).toBeInTheDocument();
  });

  it("按制度状态展示时效徽标", async () => {
    renderRoute(<KnowledgeDetailPage />, "/knowledge/:knowledgeBaseId", "/knowledge/kb_001");

    await screen.findByText("商业银行流动性风险管理办法（示例）");
    expect(screen.getAllByText("有效").length).toBeGreaterThan(0);
    expect(screen.getByText("已失效")).toBeInTheDocument();
  });
});
