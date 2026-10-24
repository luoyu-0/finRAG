/**
 * 问答接口封装。
 *
 * 与 docs/api/系统接口.md §6 对应：`POST /api/v1/qa/answer`。
 * 单元测试使用 Mock；开发与生产构建调用真实问答路由。
 */

import type { ApiClient } from "./client";
import type { QuestionRequest, QuestionResponse } from "../types/qa";

export async function askQuestion(
  client: ApiClient,
  payload: QuestionRequest,
  signal?: AbortSignal,
): Promise<QuestionResponse> {
  if (import.meta.env.MODE === "test") {
    const { mockAskQuestion } = await import("./mock");
    return mockAskQuestion(payload.question);
  }
  return client.post<QuestionResponse>("/qa/answer", payload, { signal });
}
