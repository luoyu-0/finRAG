/**
 * 鉴权接口封装。
 *
 * 与 docs/api/系统接口.md §3 对应。后端尚未实现这些接口，
 * 因此当前默认转发到 Mock 实现（见 ./mock.ts）。
 */

import type { ApiClient } from "./client";
import { MOCK_ENABLED, mockCurrentUser, mockLogin } from "./mock";
import type { LoginRequest, LoginResponse, User } from "../types/auth";

export async function login(client: ApiClient, payload: LoginRequest): Promise<LoginResponse> {
  if (MOCK_ENABLED) {
    return mockLogin(payload.username, payload.password);
  }
  return client.post<LoginResponse>("/auth/login", payload);
}

export async function logout(client: ApiClient): Promise<void> {
  if (MOCK_ENABLED) {
    return;
  }
  await client.post<void>("/auth/logout");
}

export async function fetchCurrentUser(client: ApiClient, token: string | null): Promise<User> {
  if (MOCK_ENABLED) {
    return mockCurrentUser(token);
  }
  return client.get<User>("/users/me");
}
