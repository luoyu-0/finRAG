/**
 * 鉴权接口封装。
 *
 * 与 docs/api/系统接口.md §3 对应。单元测试使用 Mock，
 * 开发与生产构建调用真实后端接口。
 */

import type { ApiClient } from "./client";
import type { LoginRequest, LoginResponse, User } from "../types/auth";

export async function login(client: ApiClient, payload: LoginRequest): Promise<LoginResponse> {
  if (import.meta.env.MODE === "test") {
    const { mockLogin } = await import("./mock");
    return mockLogin(payload.username, payload.password);
  }
  return client.post<LoginResponse>("/auth/login", payload);
}

export async function logout(client: ApiClient): Promise<void> {
  if (import.meta.env.MODE === "test") {
    return;
  }
  await client.post<void>("/auth/logout");
}

export async function fetchCurrentUser(client: ApiClient, token: string | null): Promise<User> {
  if (import.meta.env.MODE === "test") {
    const { mockCurrentUser } = await import("./mock");
    return mockCurrentUser(token);
  }
  return client.get<User>("/users/me");
}
