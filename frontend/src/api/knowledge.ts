/**
 * 知识库接口封装，对应 docs/api/系统接口.md §7。
 *
 * 演示数据用动态 import 引入，正式构建不会把它打进主包。
 */
import type { ApiClient } from "./client";
import { MOCK_ENABLED } from "./mode";
import type { Page, PageQuery } from "../types/api";
import type { KnowledgeBase, KnowledgeBaseStats } from "../types/knowledge";

export interface ListKnowledgeBasesQuery extends PageQuery {
  q?: string;
}

export interface CreateKnowledgeBasePayload {
  name: string;
  description?: string;
}

export async function listKnowledgeBases(
  client: ApiClient,
  query: ListKnowledgeBasesQuery = {},
): Promise<Page<KnowledgeBase>> {
  if (MOCK_ENABLED) {
    const { demoListKnowledgeBases } = await import("./demo");
    return demoListKnowledgeBases(query);
  }
  return client.get<Page<KnowledgeBase>>("/knowledge-bases", {
    query: { page: query.page, page_size: query.page_size, q: query.q },
  });
}

export async function getKnowledgeBase(
  client: ApiClient,
  knowledgeBaseId: string,
): Promise<KnowledgeBase> {
  if (MOCK_ENABLED) {
    const { demoGetKnowledgeBase } = await import("./demo");
    return demoGetKnowledgeBase(knowledgeBaseId);
  }
  return client.get<KnowledgeBase>(`/knowledge-bases/${knowledgeBaseId}`);
}

export async function createKnowledgeBase(
  client: ApiClient,
  payload: CreateKnowledgeBasePayload,
): Promise<KnowledgeBase> {
  if (MOCK_ENABLED) {
    const { demoCreateKnowledgeBase } = await import("./demo");
    return demoCreateKnowledgeBase(payload);
  }
  return client.post<KnowledgeBase>("/knowledge-bases", payload);
}

export async function getKnowledgeBaseStats(
  client: ApiClient,
  knowledgeBaseId: string,
): Promise<KnowledgeBaseStats> {
  if (MOCK_ENABLED) {
    const { demoGetKnowledgeBaseStats } = await import("./demo");
    return demoGetKnowledgeBaseStats(knowledgeBaseId);
  }
  return client.get<KnowledgeBaseStats>(`/knowledge-bases/${knowledgeBaseId}/stats`);
}
