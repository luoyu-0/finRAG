/**
 * 问答接口封装。
 *
 * 与 docs/api/系统接口.md §6 对应：`POST /api/v1/qa/answer`。
 *
 * 演示数据由 ./mode 的 `MOCK_ENABLED` 统一决定（单元测试与 `VITE_DEMO=1` 预览），
 * 开发与生产构建调用真实问答路由。
 */

import type { ApiClient } from "./client";
import { MOCK_ENABLED } from "./mode";
import type { QuestionRequest, QuestionResponse } from "../types/qa";

export async function askQuestion(
  client: ApiClient,
  payload: QuestionRequest,
  signal?: AbortSignal,
): Promise<QuestionResponse> {
  if (MOCK_ENABLED) {
    const { mockAskQuestion } = await import("./mock");
    return mockAskQuestion(payload.question);
  }
  return client.post<QuestionResponse>("/qa/answer", payload, { signal });
}
