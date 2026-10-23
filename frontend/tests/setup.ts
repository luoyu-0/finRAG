// 注册 jest-dom 的断言扩展，并作用于 Vitest 的 expect。
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// 未开启 Vitest 的 globals，Testing Library 的自动清理不会注册。
// 这里显式卸载每次渲染的组件，避免 DOM 在测试之间累积导致「Found multiple elements」。
afterEach(() => {
  cleanup();
});
