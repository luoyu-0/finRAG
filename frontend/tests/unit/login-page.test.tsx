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

  it("演示数据模式下提示可用账户", () => {
    renderAt("/login");

    expect(screen.getByText(/当前为演示数据模式/)).toBeInTheDocument();
    expect(screen.getByText(/admin \/ finrag2026/)).toBeInTheDocument();
  });
});
