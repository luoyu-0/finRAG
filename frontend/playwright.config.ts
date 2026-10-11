import { defineConfig, devices } from "@playwright/test";

// 端到端测试面向容器化后的真实拓扑：前端由 Nginx 提供并反向代理 /api/。
// 运行前需先启动 Compose 环境（frontend 监听 3000）。
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
