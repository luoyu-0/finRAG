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

  it("只选择一个文件也能从统一表单提交并查看任务", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("金融监管制度库");

    const file = new File(["制度正文内容"], "测试制度.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("选择文件"), file);
    expect(screen.getByText("测试制度.pdf")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "提交导入" }));

    expect(await screen.findByText(/已提交 1 个文件/)).toBeVisible();
    expect(await screen.findByRole("heading", { name: "测试制度.pdf" })).toBeVisible();
  });

  it("通过相同入口提交多份文件并保留各自任务", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("金融监管制度库");
    expect(screen.queryByText("标题（可选）")).not.toBeInTheDocument();

    await user.upload(screen.getByLabelText("选择文件"), [
      new File(["正文"], "批量样例甲.txt", { type: "text/plain" }),
      new File(["# 正文"], "批量样例乙.md", { type: "application/octet-stream" }),
    ]);
    await user.click(screen.getByRole("button", { name: "提交导入" }));

    expect(await screen.findByText(/已提交 2 个文件/)).toBeVisible();
    expect(await screen.findByRole("heading", { name: "批量样例甲.txt" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "批量样例乙.md" })).toBeVisible();
  });

  it("批量超出数量或总大小上限时阻止提交", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("金融监管制度库");
    const picker = screen.getByLabelText("选择文件");
    const submit = screen.getByRole("button", { name: "提交导入" });

    await user.upload(
      picker,
      Array.from({ length: 21 }, (_, i) => new File(["x"], `${String(i)}.txt`)),
    );
    expect(screen.getByText(/每批最多选择 20 个文件/)).toBeVisible();
    expect(submit).toBeDisabled();

    const files = ["甲.txt", "乙.txt"].map((name) => {
      const file = new File(["x"], name);
      Object.defineProperty(file, "size", { value: 25 * 1024 * 1024 });
      return file;
    });
    await user.upload(picker, files);
    expect(screen.getByText(/文件总大小超过 48 MiB/)).toBeVisible();
    expect(submit).toBeDisabled();
  });

  it("单个文件同样受 48 MiB 总大小上限限制", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("金融监管制度库");

    const big = new File(["x"], "超大制度.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 60 * 1024 * 1024 });
    await user.upload(screen.getByLabelText("选择文件"), big);

    expect(await screen.findByText(/文件总大小超过 48 MiB/)).toBeInTheDocument();
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
