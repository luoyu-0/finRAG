import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ImportPage } from "../../src/features/documents/ImportPage";
import { AuthProvider } from "../../src/stores/auth";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/import"]}>
      <AuthProvider>
        <ImportPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("文档导入页", () => {
  it("加载后展示知识库选项与导入任务", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "文档导入" })).toBeInTheDocument();
    expect(await screen.findByText("金融监管制度库")).toBeInTheDocument();
    // 演示数据包含三种任务状态
    expect((await screen.findAllByText("已完成")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("处理中").length).toBeGreaterThan(0);
    expect(screen.getByText("失败")).toBeInTheDocument();
  });

  it("未选择文件时提交按钮不可用", async () => {
    renderPage();
    await screen.findByText("金融监管制度库");

    expect(screen.getByRole("button", { name: "提交导入" })).toBeDisabled();
  });

  it("选择文件后可以提交，并提示任务已创建", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("金融监管制度库");

    const file = new File(["制度正文内容"], "测试制度.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("选择文件"), file);
    expect(screen.getByText("测试制度.pdf")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "提交导入" }));

    expect(await screen.findByText(/正在后台处理/)).toBeInTheDocument();
  });

  it("拒绝超过 50 MB 的文件", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("金融监管制度库");

    const big = new File(["x"], "超大制度.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 60 * 1024 * 1024 });
    await user.upload(screen.getByLabelText("选择文件"), big);

    expect(await screen.findByText(/超过 50 MB 上限/)).toBeInTheDocument();
  });

  it("拒绝不支持的文件类型", async () => {
    // applyAccept: false —— 绕过 input 的 accept 过滤，验证应用层的类型校验
    const user = userEvent.setup({ applyAccept: false });
    renderPage();
    await screen.findByText("金融监管制度库");

    const exe = new File(["x"], "恶意程序.exe", { type: "application/x-msdownload" });
    await user.upload(screen.getByLabelText("选择文件"), exe);

    expect(await screen.findByText(/不支持的文件类型/)).toBeInTheDocument();
  });
});
