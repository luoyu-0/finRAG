/**
 * 接口错误模型。
 *
 * 契约要求（docs/api/系统接口.md 第 1 节）：错误响应至少包含稳定的 error_code
 * 与可读 message，前端不得依赖后端异常堆栈。本模块把任意失败统一成 ApiError，
 * 使调用方只需处理一种错误类型。
 */

/** 后端错误响应体；字段可能缺失或类型不符，因此按 unknown 接收后归一化。 */
export interface ApiErrorBody {
  error_code?: unknown;
  message?: unknown;
}

/** 网络层失败（未拿到 HTTP 响应）时使用的错误码。 */
export const NETWORK_ERROR_CODE = "NETWORK_ERROR";

/** 无法从响应体解析出错误码时使用的前缀，最终形如 `HTTP_500`。 */
export const HTTP_ERROR_PREFIX = "HTTP_";

export class ApiError extends Error {
  /** HTTP 状态码；网络层失败时为 0。 */
  readonly status: number;
  /** 稳定的机器可读错误码。 */
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }

  /** 未登录、凭据无效或会话过期。 */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** 身份有效但权限不足。 */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** 未拿到 HTTP 响应（断网、超时、CORS 等）。 */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * 把一次失败的 HTTP 响应归一化为 ApiError。
 *
 * @param status HTTP 状态码
 * @param bodyText 原始响应文本；可能为空、也可能不是 JSON
 * @param statusText HTTP 状态描述，作为 message 的最后兜底
 */
export function toApiError(status: number, bodyText: string, statusText = ""): ApiError {
  let body: ApiErrorBody | null = null;
  if (bodyText.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(bodyText);
      if (parsed !== null && typeof parsed === "object") {
        body = parsed as ApiErrorBody;
      }
    } catch {
      // 响应体不是 JSON：忽略，走兜底错误码与消息。
    }
  }

  const code = asNonEmptyString(body?.error_code) ?? `${HTTP_ERROR_PREFIX}${status}`;
  const message =
    asNonEmptyString(body?.message) ?? asNonEmptyString(statusText) ?? `请求失败（HTTP ${status}）`;

  return new ApiError(status, code, message);
}

/** 把网络层异常归一化为 ApiError。 */
export function toNetworkError(cause: unknown): ApiError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new ApiError(0, NETWORK_ERROR_CODE, `无法连接服务：${detail}`);
}
