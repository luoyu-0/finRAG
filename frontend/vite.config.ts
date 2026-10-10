import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    // 本地开发时把 /api 转发到后端，与容器内 Nginx 的同源代理保持一致，
    // 避免直接跨端口请求带来的 CORS 与 Cookie 域问题。
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    // 只收集单元测试；tests/e2e 由 Playwright 负责，避免被 Vitest 误当成单元测试执行。
    include: ["tests/unit/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts"],
      // 覆盖率门槛按 NFR-4（核心模块 ≥70%）规划。当前尚无业务代码与测试，
      // 先只统计不设 fail 门槛，待真实模块与测试就位后再逐周抬升并在 CI 中硬卡。
    },
  },
});
