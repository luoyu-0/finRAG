import { describe, expect, it, vi } from "vitest";

import { ApiClient } from "../../src/api/client";
import { ApiError } from "../../src/api/errors";

/** 构造一个最小的 Response 替身，避免依赖 jsdom 未提供的 Response 全局。 */
function makeResponse(status: number, bodyText: string, statusText = ""): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: async () => bodyText,
  } as unknown as Response;
}

function jsonResponse(status: number, body: unknown, statusText = ""): Response {
  return makeResponse(status, JSON.stringify(body), statusText);
}

interface RecordedCall {
  url: string;
  init: RequestInit;
}

/** 按顺序返回预置响应，并记录每次调用的 URL 与 init。 */
function setup(responses: Response[], options: ConstructorParameters<typeof ApiClient>[0] = {}) {
  const calls: RecordedCall[] = [];
  const queue = [...responses];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) {
      throw new Error("测试未预置足够的响应");
    }
    return next;
  }) as unknown as typeof fetch;

  return { client: new ApiClient({ fetchImpl, ...options }), calls };
}

describe("ApiClient 请求成功", () => {
  it("GET 解析 JSON 并拼出默认前缀路径", async () => {
    const { client, calls } = setup([jsonResponse(200, { status: "ok", service: "backend" })]);

    const result = await client.get<{ status: string; service: string }>("/health");

    expect(result).toEqual({ status: "ok", service: "backend" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/v1/health");
    expect(calls[0]?.init.method).toBe("GET");
  });

  it("支持自定义 baseUrl", async () => {
    const { client, calls } = setup([jsonResponse(200, {})], {
      baseUrl: "https://example.test/v2",
    });

    await client.get("/ping");

    expect(calls[0]?.url).toBe("https://example.test/v2/ping");
  });

  it("POST 序列化请求体并设置 Content-Type", async () => {
    const { client, calls } = setup([jsonResponse(200, { answer: "制度依据" })]);

    const body = { question: "流动性风险如何管理？", top_k: 8 };
    const result = await client.post<{ answer: string }>("/qa/answer", body);

    expect(result.answer).toBe("制度依据");
    const init = calls[0]?.init as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(body));
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("GET 不设置 Content-Type", async () => {
    const { client, calls } = setup([jsonResponse(200, {})]);

    await client.get("/health");

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
    expect(headers.Accept).toBe("application/json");
  });

  it("204 无内容时返回 undefined", async () => {
    const { client } = setup([makeResponse(204, "")]);

    await expect(client.delete("/users/u1/sessions")).resolves.toBeUndefined();
  });

  it("空响应体返回 undefined 而不报错", async () => {
    const { client } = setup([makeResponse(200, "")]);

    await expect(client.get("/anything")).resolves.toBeUndefined();
  });

  it("成功响应体不是合法 JSON 时报 INVALID_RESPONSE", async () => {
    const { client } = setup([makeResponse(200, "<html>not json</html>")]);

    await expect(client.get("/broken")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      status: 200,
    });
  });
});

describe("ApiClient 鉴权头", () => {
  it("有 token 时发送 Bearer 头", async () => {
    const { client, calls } = setup([jsonResponse(200, {})], {
      getAccessToken: () => "token-abc",
    });

    await client.get("/users/me");

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token-abc");
  });

  it("token 为 null 时不发送 Authorization 头", async () => {
    const { client, calls } = setup([jsonResponse(200, {})], { getAccessToken: () => null });

    await client.get("/users/me");

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});

describe("ApiClient 查询参数", () => {
  it("序列化标量、数组，并跳过 null 与 undefined", async () => {
    const { client, calls } = setup([jsonResponse(200, {})]);

    await client.get("/users", {
      query: {
        page: 2,
        page_size: 20,
        role: ["user", "admin"],
        active: true,
        empty: null,
        missing: undefined,
      },
    });

    expect(calls[0]?.url).toBe(
      "/api/v1/users?page=2&page_size=20&role=user&role=admin&active=true",
    );
  });

  it("没有有效参数时不追加问号", async () => {
    const { client, calls } = setup([jsonResponse(200, {})]);

    await client.get("/users", { query: { a: null, b: undefined } });

    expect(calls[0]?.url).toBe("/api/v1/users");
  });
});

describe("ApiClient 错误归一化", () => {
  it("按契约解析 error_code 与 message", async () => {
    const { client } = setup([
      jsonResponse(401, { error_code: "AUTH_TOKEN_EXPIRED", message: "Access Token 已过期" }),
    ]);

    const error = await client.get("/users/me").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.code).toBe("AUTH_TOKEN_EXPIRED");
    expect(apiError.message).toBe("Access Token 已过期");
    expect(apiError.status).toBe(401);
    expect(apiError.isUnauthorized).toBe(true);
    expect(apiError.isForbidden).toBe(false);
  });

  it("401 触发 onUnauthorized 回调", async () => {
    const onUnauthorized = vi.fn<(error: ApiError) => void>();
    const { client } = setup([jsonResponse(401, { error_code: "AUTH_SESSION_INVALID" })], {
      onUnauthorized,
    });

    await client.get("/users/me").catch(() => undefined);

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(onUnauthorized.mock.calls[0]?.[0]).toBeInstanceOf(ApiError);
  });

  it("403 不触发 onUnauthorized，但标记为权限不足", async () => {
    const onUnauthorized = vi.fn<(error: ApiError) => void>();
    const { client } = setup([jsonResponse(403, { error_code: "AUTH_FORBIDDEN" })], {
      onUnauthorized,
    });

    const error = (await client.get("/users").catch((e: unknown) => e)) as ApiError;

    expect(error.isForbidden).toBe(true);
    expect(error.isUnauthorized).toBe(false);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("错误体不是 JSON 时回退为 HTTP_<status>", async () => {
    const { client } = setup([makeResponse(502, "Bad Gateway", "Bad Gateway")]);

    const error = (await client.get("/qa/answer").catch((e: unknown) => e)) as ApiError;

    expect(error.code).toBe("HTTP_502");
    expect(error.status).toBe(502);
  });

  it("错误体为空时使用状态描述兜底", async () => {
    const { client } = setup([makeResponse(503, "", "Service Unavailable")]);

    const error = (await client.get("/qa/answer").catch((e: unknown) => e)) as ApiError;

    expect(error.code).toBe("HTTP_503");
    expect(error.message).toBe("Service Unavailable");
  });

  it("error_code 存在但 message 缺失时给出可读兜底消息", async () => {
    const { client } = setup([jsonResponse(409, { error_code: "USER_USERNAME_CONFLICT" })]);

    const error = (await client.post("/users", {}).catch((e: unknown) => e)) as ApiError;

    expect(error.code).toBe("USER_USERNAME_CONFLICT");
    expect(error.message).toContain("409");
  });

  it("网络层失败归一化为 NETWORK_ERROR", async () => {
    const fetchImpl = (async () => {
      throw new Error("Failed to fetch");
    }) as unknown as typeof fetch;
    const client = new ApiClient({ fetchImpl });

    const error = (await client.get("/health").catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.status).toBe(0);
    expect(error.isNetworkError).toBe(true);
  });
});
