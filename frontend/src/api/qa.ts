/**
 * 问答接口封装。
 *
 * 与 docs/api/系统接口.md §6 对应：`POST /api/v1/qa/answer`。
 * 后端已实现核心编排但尚未挂载 HTTP 路由，因此当前默认转发到 Mock 实现。
 */

import type { ApiClient } from "./client";
import { MOCK_ENABLED, mockAskQuestion } from "./mock";
import type { QuestionRequest, QuestionResponse } from "../types/qa";

export async function askQuestion(
  client: ApiClient,
  payload: QuestionRequest,
): Promise<QuestionResponse> {
  if (MOCK_ENABLED) {
    return mockAskQuestion(payload.question);
  }
  return client.post<QuestionResponse>("/qa/answer", payload);
}
