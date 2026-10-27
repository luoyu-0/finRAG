import { afterEach, expect, it, vi } from "vitest";

function response(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("并发刷新请求共用一次 Cookie 轮换", async () => {
  const fetchMock = vi.fn<typeof fetch>(async () => response({ access_token: "new-token" }));
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  const { refreshAccessToken, getAccessToken } = await import("../../src/api/session");

  const tokens = await Promise.all([refreshAccessToken(), refreshAccessToken()]);

  expect(tokens).toEqual(["new-token", "new-token"]);
  expect(getAccessToken()).toBe("new-token");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
