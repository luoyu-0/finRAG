/**
 * 统一 HTTP 客户端。
 *
 * 设计依据 docs/api/系统接口.md 第 1 节「通用约定」：
 * - API 统一位于 `/api/v1`，JSON 字段使用 snake_case；
 * - Access Token 通过 `Authorization: Bearer <token>` 发送；
 * - `401` 表示未登录或会话过期，`403` 表示权限不足；
 * - 错误响应包含稳定的 error_code 与可读 message。
 *
 * 默认使用同源相对路径，因此容器内由 Nginx 反向代理、本地开发由 Vite 代理，
 * 两种情形都无需跨域配置。
 */
import { ApiError, toApiError, toNetworkError } from "./errors";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** 查询参数取值；数组会展开为重复的同名参数。 */
export type QueryValue =
  string | number | boolean | null | undefined | readonly (string | number)[];

export interface ApiClientOptions {
  /** 接口前缀，默认 `/api/v1`。 */
  baseUrl?: string;
  /** 便于测试注入的 fetch 实现。 */
  fetchImpl?: typeof fetch;
  /** 返回当前 Access Token；返回 null 表示未登录。 */
  getAccessToken?: () => string | null;
  /** 收到 401 时的回调，用于触发一次会话刷新或跳转登录。 */
  onUnauthorized?: (error: ApiError) => void;
  /** Access Token 过期时单次换票；返回 null 表示无法恢复会话。 */
  refreshAccessToken?: () => Promise<string | null>;
}

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

export const DEFAULT_BASE_URL = "/api/v1";

function buildQueryString(query: Record<string, QueryValue> | undefined): string {
  if (!query) {
    return "";
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, String(item));
      }
      continue;
    }
    params.append(key, String(value));
  }

  const serialized = params.toString();
  return serialized === "" ? "" : `?${serialized}`;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly getAccessToken?: () => string | null;
  private readonly onUnauthorized?: (error: ApiError) => void;
  private readonly refreshAccessToken?: () => Promise<string | null>;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.getAccessToken = options.getAccessToken;
    this.onUnauthorized = options.onUnauthorized;
    this.refreshAccessToken = options.refreshAccessToken;
  }

  async request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
    allowRefresh = true,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}${buildQueryString(options.query)}`;

    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const token = this.getAccessToken?.();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: options.signal,
      });
    } catch (cause) {
      // 未拿到 HTTP 响应：断网、超时或请求被中断。
      throw toNetworkError(cause);
    }

    if (!response.ok) {
      const error = toApiError(
        response.status,
        await this.readBodyText(response),
        response.statusText,
      );
      if (error.isUnauthorized) {
        if (allowRefresh && token && this.refreshAccessToken && !path.startsWith("/auth/")) {
          try {
            if (await this.refreshAccessToken()) {
              return this.request<T>(method, path, body, options, false);
            }
          } catch {
            // 刷新失败后按原 401 统一清理会话。
          }
        }
        this.onUnauthorized?.(error);
      }
      throw error;
    }

    return await this.parseSuccessBody<T>(response);
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("GET", path, undefined, options);
  }

  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("POST", path, body, options);
  }

  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("PATCH", path, body, options);
  }

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, undefined, options);
  }

  private async readBodyText(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return "";
    }
  }

  private async parseSuccessBody<T>(response: Response): Promise<T> {
    // 204 或空响应体没有可解析内容。
    if (response.status === 204) {
      return undefined as T;
    }
    const text = await this.readBodyText(response);
    if (text === "") {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(response.status, "INVALID_RESPONSE", "服务返回了无法解析的响应");
    }
  }
}
