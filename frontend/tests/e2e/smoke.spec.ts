import { expect, test } from "@playwright/test";

test("容器化前端可渲染并通过 Nginx 访问后端健康接口", async ({ page, request }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "金融制度 RAG 知识问答系统", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "查看后端 API 文档" })).toHaveAttribute(
    "href",
    "/api/docs",
  );

  const response = await request.get("/api/v1/health");

  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toEqual({ status: "ok", service: "backend" });
});
