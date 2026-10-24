/**
 * 会话与共享客户端实例。
 *
 * Access Token 只保存在内存中（符合 `docs/architecture/系统架构.md` §5.2），
 * 刷新页面后依靠 Refresh Cookie 恢复。此模块用一个模块级变量承载它，
 * 避免鉴权状态与 HTTP 客户端互相引用造成循环依赖。
 */

import { ApiClient } from "./client";
import { ApiError } from "./errors";

let accessToken: string | null = null;
let unauthorizedHandler: ((error: ApiError) => void) | null = null;
let refreshPromise: Promise<string> | null = null;
const refreshClient = new ApiClient();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** 由鉴权状态容器注册；收到 401 时被调用，用于清理会话并跳转登录。 */
export function setUnauthorizedHandler(handler: ((error: ApiError) => void) | null): void {
  unauthorizedHandler = handler;
}

/** 并发请求和 React StrictMode 共用一次 Refresh Cookie 轮换。 */
export function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = refreshClient
      .post<{ access_token: string }>("/auth/refresh")
      .then((result) => {
        setAccessToken(result.access_token);
        return result.access_token;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

/**
 * 应用共享的 HTTP 客户端。
 *
 * 默认使用相对路径 `/api/v1`：容器内由 Nginx 反向代理、本地开发由 Vite 代理，
 * 两种拓扑都无需跨域配置。
 */
export const apiClient = new ApiClient({
  getAccessToken,
  refreshAccessToken,
  onUnauthorized: (error) => {
    accessToken = null;
    unauthorizedHandler?.(error);
  },
});
