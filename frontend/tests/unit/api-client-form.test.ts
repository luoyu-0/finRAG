import { describe, expect, it, vi } from "vitest";

import { ApiClient } from "../../src/api/client";
import { ApiError } from "../../src/api/errors";

function makeResponse(status: number, bodyText: string, statusText = ""): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: async () => bodyText,
  } as unknown as Response;
}

interface RecordedCall {
  url: string;
  init: RequestInit;
}

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

function makeForm(): FormData {
  const form = new FormData();
  form.append("file", new File(["正文"], "制度.pdf", { type: "application/pdf" }));
  form.append("knowledge_base_id", "kb_001");
  return form;
}

describe("ApiClient 文件上传（postForm）", () => {
  it("以 POST 提交 FormData，且不设置 Content-Type 交由浏览器写入 boundary", async () => {
    const { client, calls } = setup([makeResponse(202, '{"ok":true}')]);
    const form = makeForm();

    const result = await client.postForm<{ ok: boolean }>("/documents", form);

    expect(result).toEqual({ ok: true });
    expect(calls[0].url).toBe("/api/v1/documents");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe(form);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
    expect(headers.Authorization).toBeUndefined();
  });

  it("已登录时附带 Bearer 令牌", async () => {
    const { client, calls } = setup([makeResponse(202, "{}")], {
      getAccessToken: () => "token-abc",
    });

    await client.postForm("/documents", makeForm());

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token-abc");
  });

  it("失败时抛出带稳定错误码的 ApiError", async () => {
    const { client } = setup([
      makeResponse(413, JSON.stringify({ error_code: "DOCUMENT_TOO_LARGE", message: "文件过大" })),
    ]);

    await expect(client.postForm("/documents", makeForm())).rejects.toMatchObject({
      code: "DOCUMENT_TOO_LARGE",
      message: "文件过大",
      status: 413,
    });
  });

  it("401 时触发未授权回调", async () => {
    const onUnauthorized = vi.fn<(error: ApiError) => void>();
    const { client } = setup(
      [makeResponse(401, JSON.stringify({ error_code: "AUTH_TOKEN_EXPIRED" }))],
      {
        getAccessToken: () => "expired-token",
        onUnauthorized,
      },
    );

    await expect(client.postForm("/documents", makeForm())).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("网络异常时转换为网络错误", async () => {
    const client = new ApiClient({
      fetchImpl: (async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
    });

    await expect(client.postForm("/documents", makeForm())).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });
});
