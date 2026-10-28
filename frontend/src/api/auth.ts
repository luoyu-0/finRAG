/**
 * 鉴权接口封装。
 *
 * 与 docs/api/系统接口.md §3 对应。
 *
 * 演示数据由 ./mode 的 `MOCK_ENABLED` 统一决定：单元测试与 `VITE_DEMO=1` 预览
 * 使用本地演示数据，开发与生产构建调用真实后端接口。
 * 使用动态 import 引入演示数据，正式构建不会把它打进包内。
 */

import type { ApiClient } from "./client";
import { MOCK_ENABLED } from "./mode";
import type { LoginRequest, LoginResponse, User } from "../types/auth";

export async function login(client: ApiClient, payload: LoginRequest): Promise<LoginResponse> {
  if (MOCK_ENABLED) {
    const { mockLogin } = await import("./mock");
    return mockLogin(payload.username, payload.password);
  }
  return client.post<LoginResponse>("/auth/login", payload);
}

export async function register(client: ApiClient, payload: LoginRequest): Promise<LoginResponse> {
  if (MOCK_ENABLED) {
    const { mockRegister } = await import("./mock");
    return mockRegister(payload.username, payload.password);
  }
  return client.post<LoginResponse>("/auth/register", payload);
}

export async function logout(client: ApiClient): Promise<void> {
  if (MOCK_ENABLED) {
    return;
  }
  await client.post<void>("/auth/logout");
}

export async function fetchCurrentUser(client: ApiClient, token: string | null): Promise<User> {
  if (MOCK_ENABLED) {
    const { mockCurrentUser } = await import("./mock");
    return mockCurrentUser(token);
  }
  return client.get<User>("/users/me");
}
