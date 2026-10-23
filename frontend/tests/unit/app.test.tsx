import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { App } from "../../src/App";
import { AuthProvider } from "../../src/stores/auth";

describe("App", () => {
  it("未登录访问根路径时被守卫重定向到登录页", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { level: 1, name: "登录" })).toBeInTheDocument();
  });

  it("未匹配的路径显示 404 页面", async () => {
    render(
      <MemoryRouter initialEntries={["/不存在的页面"]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("页面不存在")).toBeInTheDocument();
  });
});
