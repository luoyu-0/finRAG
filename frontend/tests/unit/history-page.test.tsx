import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { HistoryPage } from "../../src/features/history/HistoryPage";
import { AuthProvider } from "../../src/stores/auth";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/history"]}>
      <AuthProvider>
        <HistoryPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("问答历史页", () => {
  it("展示记录、证据支持度与已收藏标识", async () => {
    renderPage();

    expect(await screen.findByText("商业银行应如何管理流动性风险？")).toBeInTheDocument();
    expect(screen.getByText("支付业务许可证期满后最迟何时提出续展申请？")).toBeInTheDocument();
    expect(screen.getByText("已收藏")).toBeInTheDocument();
    expect(screen.getByText("共 3 条")).toBeInTheDocument();
  });

  it("展开后展示证据支持度、行内条文角标与 trace_id", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("商业银行应如何管理流动性风险？");

    await user.click(screen.getAllByRole("button", { name: "展开" })[0]);

    expect(await screen.findByText(/证据支持度：较强/)).toBeInTheDocument();
    expect(screen.getByText(/trace_demo_001/)).toBeInTheDocument();

    // 正文内嵌标记时用行内角标，不渲染底部来源列表
    const anchors = screen.getAllByRole("button", { name: /第 \d 条条文来源/ });
    expect(anchors.length).toBeGreaterThan(0);
    await user.hover(anchors[0]);
    expect(await screen.findByText("第二十条")).toBeInTheDocument();
  });

  it("未收藏的记录可以收藏", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("支付业务许可证期满后最迟何时提出续展申请？");

    expect(screen.getAllByRole("button", { name: "收藏" })).toHaveLength(2);
    await user.click(screen.getAllByRole("button", { name: "收藏" })[0]);

    // 收藏成功后该记录的按钮变为「取消收藏」，列表刷新是异步的。
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "取消收藏" })).toHaveLength(2);
    });
  });

  it("未检索到证据的记录支持度为 0% 且无引用", async () => {
    renderPage();

    const question = await screen.findByText("残缺污损人民币的兑换标准是什么？");
    expect(question).toBeInTheDocument();
    expect(screen.getByText("证据支持度 0%")).toBeInTheDocument();
  });
});
