import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { App } from "../../src/App";
import { AuthProvider } from "../../src/stores/auth";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("登录页", () => {
  it("凭据错误时显示统一错误信息", async () => {
    const user = userEvent.setup();
    renderAt("/login");

    await user.type(screen.getByLabelText("用户名"), "user");
    await user.type(screen.getByLabelText("密码"), "错误的密码");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("用户名或密码错误");
  });

  it("凭据正确时进入制度问答页", async () => {
    const user = userEvent.setup();
    renderAt("/login");

    await user.type(screen.getByLabelText("用户名"), "admin");
    await user.type(screen.getByLabelText("密码"), "finrag2026");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByRole("heading", { name: "提问" })).toBeInTheDocument();
    expect(screen.getByText("管理员（演示）")).toBeInTheDocument();
  });

  it("演示数据模式下不展示固定凭据", () => {
    renderAt("/login");

    expect(screen.getByText(/单元测试演示数据模式/)).toBeInTheDocument();
    expect(screen.queryByText(/finrag2026/)).not.toBeInTheDocument();
  });

  it("可从登录页注册普通账户并直接进入问答页", async () => {
    const user = userEvent.setup();
    renderAt("/login");

    await user.click(screen.getByRole("button", { name: "注册新账户" }));
    await user.type(screen.getByLabelText("用户名"), "fresh_user_42");
    await user.type(screen.getByLabelText("密码"), "simple");
    await user.click(screen.getByRole("button", { name: "注册并登录" }));

    expect(await screen.findByRole("heading", { name: "提问" })).toBeInTheDocument();
    expect(screen.getByText("演示用户")).toBeInTheDocument();
  });
});
