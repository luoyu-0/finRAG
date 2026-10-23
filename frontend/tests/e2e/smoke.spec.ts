import { expect, test } from "@playwright/test";

/**
 * 容器链路冒烟测试。
 *
 * 验证三件事：
 * 1. 前端由 Nginx 正常提供，未登录访问根路径会被路由守卫跳转到登录页；
 * 2. 登录后可以进入制度问答页并完成一次提问，回答带条文引用；
 * 3. Nginx 的 `/api` 反向代理确实到达后端健康检查接口。
 *
 * 业务接口尚未实现，问答结果来自前端演示数据（见 src/api/mock.ts）。
 */
test("登录后可进入制度问答页并完成一次提问", async ({ page, request }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "登录" })).toBeVisible();

  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("finrag2026");
  await page.getByRole("button", { name: "登录" }).click();

  await expect(page.getByRole("heading", { name: "提问" })).toBeVisible();

  await page.getByLabel("问题").fill("商业银行应如何管理流动性风险？");
  await page.getByRole("button", { name: "提问", exact: true }).click();

  await expect(page.getByText(/根据检索到的示例条文/)).toBeVisible();
  await expect(page.getByText("第二十条")).toBeVisible();

  const health = await request.get("/api/v1/health");
  expect(health.ok()).toBe(true);
  await expect(health.json()).resolves.toEqual({ status: "ok", service: "backend" });
});
