import { describe, expect, it, vi } from "vitest";
import { ReadableStream } from "node:stream/web";
import { TextEncoder } from "node:util";
import { readQuestionStream } from "../../src/api/qa";
import { ApiClient } from "../../src/api/client";

function response(text: string): Response {
  const bytes = new TextEncoder().encode(text);
  return {
    ok: true,
    headers: { get: () => "text/event-stream" },
    body: new ReadableStream({
      start(controller) {
        // 每个字节单独发送，覆盖中文 UTF-8 和 CRLF 的跨包边界。
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    }),
  } as unknown as Response;
}

describe("问答流", () => {
  it("解码跨包正文并接收最终结果", async () => {
    const delta = vi.fn();
    const result = await readQuestionStream(response(
      'event: delta\r\ndata: {"text":"中文正文"}\r\n\r\n' +
      'event: done\ndata: {"answer":"中文正文","citations":[],"evidence_support":{}}\n\n',
    ), delta);
    expect(delta).toHaveBeenCalledWith("中文正文");
    expect(result.answer).toBe("中文正文");
  });

  it("没有 done 的连接结束不能当作成功", async () => {
    await expect(readQuestionStream(response('event: delta\ndata: {"text":"部分回答"}\n\n')))
      .rejects.toMatchObject({ code: "QA_STREAM_INCOMPLETE" });
  });

  it("将生成失败事件转换为可展示错误", async () => {
    await expect(readQuestionStream(response('event: error\ndata: {"error_code":"RAG_GENERATION_FAILED","message":"生成失败"}\n\n')))
      .rejects.toMatchObject({ code: "RAG_GENERATION_FAILED" });
  });

  it("流式请求沿用一次 401 刷新且不预读响应体", async () => {
    const refresh = vi.fn(async () => "new-token");
    const stream = response('event: done\ndata: {}\n\n');
    const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: false, status: 401, text: async () => '{"error_code":"AUTH_TOKEN_EXPIRED","message":"过期"}' }).mockResolvedValueOnce(stream);
    const client = new ApiClient({ fetchImpl, getAccessToken: () => "token", refreshAccessToken: refresh });
    expect(await client.postStream("/qa/answer/stream", { question: "问题" })).toBe(stream);
    expect(refresh).toHaveBeenCalledOnce();
    expect(stream.body?.locked).toBe(false);
  });
});
