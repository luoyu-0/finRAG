/**
 * Mock 数据层。
 *
 * 仅供前端单元测试验证界面分支。正式构建会请求真实业务接口；
 * 检索与生成 Provider 未接入时，后端返回明确的不可用错误。
 *
 * 仅单元测试启用；正式构建和本地开发均调用真实业务接口。
 *
 * 注意：此处的制度标题、条文编号与回答内容**均为虚构示例**，只用于展示
 * 界面结构与交互，不代表任何真实监管规定。启用 Mock 时界面会显示「演示数据」标识。
 */

import { ApiError } from "./errors";
import type { LoginResponse, Role, User } from "../types/auth";
import type { Citation, QuestionResponse } from "../types/qa";

/** 演示模式下的模拟网络延迟（毫秒）。 */
const MOCK_LATENCY_MS = 420;

function delay<T>(value: T, ms = MOCK_LATENCY_MS): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
  });
}

/** 演示账户；登录页会提示这些凭据。 */
export const MOCK_ACCOUNTS: ReadonlyArray<{ username: string; password: string; role: Role }> = [
  { username: "admin", password: "finrag2026", role: "admin" },
  { username: "user", password: "finrag2026", role: "user" },
];
const registeredAccounts = new Map<string, string>();

function toUser(username: string, role: Role): User {
  return {
    id: role === "admin" ? "user_admin" : "user_demo",
    username,
    display_name: role === "admin" ? "管理员（演示）" : "演示用户",
    role,
    status: "active",
  };
}

export async function mockLogin(username: string, password: string): Promise<LoginResponse> {
  await delay(null, 300);
  const account = MOCK_ACCOUNTS.find(
    (item) => item.username === username.trim() && item.password === password,
  );
  const registered = registeredAccounts.get(username.trim()) === password;
  if (!account && !registered) {
    throw new ApiError(401, "AUTH_INVALID_CREDENTIALS", "用户名或密码错误");
  }
  const role = account?.role ?? "user";
  return {
    access_token: `mock-token-${role}`,
    token_type: "bearer",
    expires_in: 900,
    user: toUser(username.trim(), role),
  };
}

export async function mockRegister(username: string, password: string): Promise<LoginResponse> {
  await delay(null, 300);
  const normalized = username.trim();
  if (!normalized || !password) {
    throw new ApiError(422, "VALIDATION_ERROR", "用户名和密码不能为空");
  }
  if (
    MOCK_ACCOUNTS.some((account) => account.username === normalized) ||
    registeredAccounts.has(normalized)
  ) {
    throw new ApiError(409, "AUTH_USERNAME_EXISTS", "用户名已存在");
  }
  registeredAccounts.set(normalized, password);
  return {
    access_token: "mock-token-user",
    token_type: "bearer",
    expires_in: 900,
    user: toUser(normalized, "user"),
  };
}

export function mockCurrentUser(token: string | null): User {
  const role: Role = token?.includes("admin") ? "admin" : "user";
  return toUser(role === "admin" ? "admin" : "user", role);
}

const DEMO_CITATIONS: Citation[] = [
  {
    label: "S1",
    document_id: "doc_demo_001",
    version_id: "ver_demo_001",
    chunk_id: "chunk_demo_001",
    title: "商业银行流动性风险管理办法（示例）",
    page_number: 12,
    article_number: "第二十条",
    source_url: null,
    excerpt:
      "商业银行应当建立与本行规模、业务复杂程度相适应的流动性风险管理体系，并明确董事会与高级管理层在流动性风险管理中的职责。",
  },
  {
    label: "S2",
    document_id: "doc_demo_001",
    version_id: "ver_demo_001",
    chunk_id: "chunk_demo_042",
    title: "商业银行流动性风险管理办法（示例）",
    page_number: 18,
    article_number: "第三十四条",
    source_url: null,
    excerpt:
      "商业银行应当持续监测现金流缺口、流动性覆盖率等流动性风险指标，并对突破预警限额的情况及时报告。",
  },
  {
    label: "S3",
    document_id: "doc_demo_002",
    version_id: "ver_demo_002",
    chunk_id: "chunk_demo_107",
    title: "银行业金融机构压力测试指引（示例）",
    page_number: 6,
    article_number: "第九条",
    source_url: null,
    excerpt:
      "银行业金融机构应当定期开展压力测试，并根据压力测试结果评估流动性风险水平，完善流动性风险应急预案。",
  },
];

const DEMO_ANSWER = [
  "根据检索到的示例条文，商业银行的流动性风险管理通常包含三个层面：",
  "",
  "1. 治理与策略：董事会与高级管理层承担流动性风险的最终责任，需明确风险偏好与流动性风险管理策略。[S1]",
  "2. 限额与监测：建立现金流缺口、流动性覆盖率等限额指标，并对指标进行持续监测与预警。[S1][S2]",
  "3. 压力测试与应急预案：定期开展压力测试，依据测试结果制定并演练流动性应急预案。[S3]",
  "",
  "以上内容由演示数据生成，仅用于展示界面与交互流程，不代表真实监管规定。",
].join("\n");

/** 演示：触发「未检索到有效证据」分支的关键词。 */
const NO_EVIDENCE_KEYWORD = "无证据";

export async function mockAskQuestion(question: string): Promise<QuestionResponse> {
  await delay(null);

  if (question.includes(NO_EVIDENCE_KEYWORD)) {
    return {
      answer: "未在当前有效制度中检索到足够依据，暂无法回答该问题。",
      citations: [],
      evidence_support: {
        score: 0,
        level: "none",
        method: "retrieval_evidence_v1",
        explanation: "未检索到可用于回答的有效证据；该分数不是答案正确概率。",
      },
      warnings: [],
      trace_id: "trace_demo_no_evidence",
    };
  }

  return {
    answer: DEMO_ANSWER,
    citations: DEMO_CITATIONS,
    evidence_support: {
      score: 0.82,
      level: "strong",
      method: "retrieval_evidence_v1",
      explanation: "表示当前检索证据对回答的支持程度，不是答案正确概率。",
    },
    warnings: [],
    trace_id: "trace_demo_strong",
  };
}
