/**
 * 问答接口封装。
 *
 * 与 docs/api/系统接口.md §6 对应：`POST /api/v1/qa/answer`。
 *
 * 演示数据由 ./mode 的 `MOCK_ENABLED` 统一决定（单元测试与 `VITE_DEMO=1` 预览），
 * 开发与生产构建调用真实问答路由。
 */

import type { ApiClient } from "./client";
import { ApiError } from "./errors";
import { MOCK_ENABLED } from "./mode";
import type { QuestionRequest, QuestionResponse } from "../types/qa";

export async function askQuestion(
  client: ApiClient,
  payload: QuestionRequest,
  signal?: AbortSignal,
  onDelta?: (text: string) => void,
): Promise<QuestionResponse> {
  if (MOCK_ENABLED) {
    const { mockAskQuestion } = await import("./mock");
    return mockAskQuestion(payload.question);
  }
  const response = await client.postStream("/qa/answer/stream", payload, { signal });
  return readQuestionStream(response, onDelta);
}

export async function readQuestionStream(
  response: Response,
  onDelta?: (text: string) => void,
): Promise<QuestionResponse> {
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
    throw new ApiError(502, "INVALID_RESPONSE", "服务未返回有效的回答流");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer = (buffer + decoder.decode(value, { stream: !done })).replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const lines = frame.split("\n");
        const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
        const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        const payload = JSON.parse(data);
        if (event === "error") throw new ApiError(502, payload.error_code, payload.message);
        if (event === "delta" && typeof payload.text === "string") onDelta?.(payload.text);
        if (event === "done" && typeof payload.answer === "string" && Array.isArray(payload.citations) && payload.evidence_support) {
          return payload as QuestionResponse;
        }
      }
      if (done) throw new ApiError(502, "QA_STREAM_INCOMPLETE", "回答连接中断，请重试");
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
