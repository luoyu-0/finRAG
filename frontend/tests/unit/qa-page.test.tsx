import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { App } from "../../src/App";
import { AuthProvider } from "../../src/stores/auth";

async function loginAndOpenQa() {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

  await user.type(screen.getByLabelText("用户名"), "user");
  await user.type(screen.getByLabelText("密码"), "finrag2026");
  await user.click(screen.getByRole("button", { name: "登录" }));
  await screen.findByRole("heading", { name: "提问" });

  return user;
}

describe("制度问答页", () => {
  it("初始状态提示还没有提问", async () => {
    await loginAndOpenQa();

    expect(screen.getByText("还没有提问")).toBeInTheDocument();
  });

  it("提问后展示回答、证据支持度与行内条文角标", async () => {
    const user = await loginAndOpenQa();

    await user.type(screen.getByLabelText("问题"), "商业银行应如何管理流动性风险？");
    await user.click(screen.getByRole("button", { name: "提问" }));

    expect(await screen.findByText(/根据检索到的示例条文/)).toBeInTheDocument();
    expect(screen.getByText(/证据支持度：较强/)).toBeInTheDocument();
    expect(screen.getByText(/可点击查看条文来源/)).toBeInTheDocument();
    expect(screen.getByText(/trace_demo_strong/)).toBeInTheDocument();

    // 正文内嵌 [S1]/[S2]/[S3] → 渲染为角标，底部不再堆来源列表
    expect(screen.getAllByRole("button", { name: /第 \d 条条文来源/ }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/条文来源（3）/)).not.toBeInTheDocument();
  });

  it("悬停角标显示来源卡片", async () => {
    const user = await loginAndOpenQa();

    await user.type(screen.getByLabelText("问题"), "商业银行应如何管理流动性风险？");
    await user.click(screen.getByRole("button", { name: "提问" }));
    await screen.findByText(/根据检索到的示例条文/);

    await user.hover(screen.getAllByRole("button", { name: /第 \d 条条文来源/ })[0]);

    expect(await screen.findByText("第二十条")).toBeInTheDocument();
    expect(screen.getByText("分块 chunk_demo_001")).toBeInTheDocument();
    expect(screen.getByText(/商业银行应当建立与本行规模/)).toBeInTheDocument();
  });

  it("点击角标跳转到知识库并定位该文档", async () => {
    const user = await loginAndOpenQa();

    await user.type(screen.getByLabelText("问题"), "商业银行应如何管理流动性风险？");
    await user.click(screen.getByRole("button", { name: "提问" }));
    await screen.findByText(/根据检索到的示例条文/);

    await user.click(screen.getAllByRole("button", { name: /第 \d 条条文来源/ })[0]);

    // 跳到该引用所属知识库的详情页，并定位、高亮来源文档
    expect(await screen.findByRole("heading", { name: "金融监管制度库" })).toBeInTheDocument();
    expect(await screen.findByText("导入健康度")).toBeInTheDocument();
    expect(
      await screen.findByText(/已定位到来源文档：商业银行流动性风险管理办法/),
    ).toBeInTheDocument();
  });

  it("未检索到证据时给出无依据回答且不展示引用", async () => {
    const user = await loginAndOpenQa();

    await user.click(screen.getByRole("button", { name: "演示：无证据时如何回应？" }));

    expect(await screen.findByText(/暂无法回答该问题/)).toBeInTheDocument();
    expect(screen.getByText("本次回答没有引用任何制度条文。")).toBeInTheDocument();
    expect(screen.getByText(/证据支持度：无依据/)).toBeInTheDocument();
  });

  it("问题为空时提问按钮不可用", async () => {
    await loginAndOpenQa();

    expect(screen.getByRole("button", { name: "提问" })).toBeDisabled();
  });
});
