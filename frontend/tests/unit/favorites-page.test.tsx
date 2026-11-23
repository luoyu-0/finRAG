import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import * as favoritesApi from "../../src/api/favorites";

import { FavoritesPage } from "../../src/features/favorites/FavoritesPage";
import { AuthProvider } from "../../src/stores/auth";
import type { FavoriteRecord } from "../../src/types/history";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/favorites"]}>
      <AuthProvider>
        <FavoritesPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("我的收藏页", () => {
  it("展示收藏回答的 Markdown 与行内角标", async () => {
    renderPage();

    expect(await screen.findByText("商业银行应如何管理流动性风险？")).toBeInTheDocument();
    expect(screen.getByText("共 1 条")).toBeInTheDocument();
    expect(screen.getByText("2 条引用")).toBeInTheDocument();
    expect(screen.getByText(/证据支持度：较强 82%/)).toBeInTheDocument();
    // 与问答页一致：Markdown 标题渲染成标题，[S1][S2] 渲染成可点角标，不再露出原始标记。
    expect(screen.getByRole("heading", { name: "结论" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /条条文来源/ })).toHaveLength(2);
    expect(screen.queryByText(/### 结论/)).not.toBeInTheDocument();
  });

  it("取消收藏后列表变为空状态", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("共 1 条");

    await user.click(screen.getByRole("button", { name: "取消收藏" }));

    expect(await screen.findByText("还没有收藏")).toBeInTheDocument();
  });

  it("取消收藏后补齐从下一页前移的记录", async () => {
    const user = userEvent.setup();
    let items = Array.from({ length: 11 }, (_, index): FavoriteRecord => ({
      id: `favorite-${String(index)}`,
      qa_id: `qa-${String(index)}`,
      question: `测试收藏 ${String(index + 1)}`,
      answer_excerpt: "摘要",
      answer: "回答",
      citations: [],
      evidence_support: { score: 0, level: "none" },
      citation_count: 0,
      created_at: "2026-11-20T12:00:00Z",
    }));
    const list = vi.spyOn(favoritesApi, "listFavorites").mockImplementation(() =>
      Promise.resolve({
        items: items.slice(0, 10),
        page: 1,
        page_size: 10,
        total: items.length,
        has_next: items.length > 10,
      }),
    );
    const remove = vi.spyOn(favoritesApi, "removeFavorite").mockImplementation((_client, id) => {
      items = items.filter((item) => item.id !== id);
      return Promise.resolve();
    });

    try {
      renderPage();
      await screen.findByText("共 11 条");
      await user.click(screen.getAllByRole("button", { name: "取消收藏" })[0]);

      expect(await screen.findByText("测试收藏 11")).toBeInTheDocument();
      expect(screen.getByText("共 10 条")).toBeInTheDocument();
      expect(screen.queryByText("测试收藏 1")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
    } finally {
      list.mockRestore();
      remove.mockRestore();
    }
  });
});
