import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { App } from "../../src/App";
import { AuthProvider } from "../../src/stores/auth";

/** 走完整应用路由（演示数据），验证管理员可以修改知识库描述。 */
describe("知识库信息编辑", () => {
  it("管理员修改描述后头部立即更新", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("用户名"), "admin");
    await user.type(screen.getByLabelText("密码"), "finrag2026");
    await user.click(screen.getByRole("button", { name: "登录" }));
    await screen.findByRole("heading", { name: "提问" });

    await user.click(screen.getByRole("link", { name: "知识库" }));
    await user.click(await screen.findByRole("link", { name: "金融监管制度库" }));

    await user.click(await screen.findByRole("button", { name: "编辑信息" }));
    const description = await screen.findByLabelText("描述（可选）");
    await user.clear(description);
    await user.type(description, "修改后的知识库描述");
    await user.click(screen.getByRole("button", { name: "保存" }));

    // textarea 的当前值也会被算作文本节点，这里按页头描述段落断言。
    expect(
      await screen.findByText("修改后的知识库描述", { selector: ".page-head__desc" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "编辑知识库" })).not.toBeInTheDocument();
    });
  });
});
