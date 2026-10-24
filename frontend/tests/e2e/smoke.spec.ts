/// <reference types="node" />
import { expect, test } from "@playwright/test";

/**
 * 容器链路冒烟测试。
 *
 * 验证三件事：
 * 1. 前端由 Nginx 正常提供，未登录访问根路径会被路由守卫跳转到登录页；
 * 2. 使用后端真实账户登录，问答服务未接入时显示明确的 503 错误；
 * 3. Nginx 的 `/api` 反向代理确实到达后端健康检查接口。
 *
 */
test("真实登录后问答接口返回明确的不可用状态", async ({ page, request }) => {
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!password) {
    throw new Error("E2E_ADMIN_PASSWORD 未设置");
  }
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "登录" })).toBeVisible();

  await page.getByLabel("用户名").fill(process.env.E2E_ADMIN_USERNAME ?? "admin");
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();

  await expect(page.getByRole("heading", { name: "提问" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "提问" })).toBeVisible();

  await page.getByLabel("问题").fill("商业银行应如何管理流动性风险？");
  await page.getByRole("button", { name: "提问", exact: true }).click();

  await expect(page.getByText("检索服务尚未接入")).toBeVisible();
  await expect(page.getByText("RAG_RETRIEVAL_UNAVAILABLE")).toBeVisible();

  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "登录" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "登录" })).toBeVisible();

  const health = await request.get("/api/v1/health");
  expect(health.ok()).toBe(true);
  await expect(health.json()).resolves.toEqual({ status: "ok", service: "backend" });
});
