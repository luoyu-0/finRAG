import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { FavoritesPage } from "../../src/features/favorites/FavoritesPage";
import { AuthProvider } from "../../src/stores/auth";

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
});
