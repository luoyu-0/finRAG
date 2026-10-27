/** 知识库接口封装，对应 docs/api/系统接口.md §7。 */
import type { ApiClient } from "./client";
import {
  demoCreateKnowledgeBase,
  demoGetKnowledgeBase,
  demoGetKnowledgeBaseStats,
  demoListKnowledgeBases,
} from "./demo";
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
    return demoGetKnowledgeBase(knowledgeBaseId);
  }
  return client.get<KnowledgeBase>(`/knowledge-bases/${knowledgeBaseId}`);
}

export async function createKnowledgeBase(
  client: ApiClient,
  payload: CreateKnowledgeBasePayload,
): Promise<KnowledgeBase> {
  if (MOCK_ENABLED) {
    return demoCreateKnowledgeBase(payload);
  }
  return client.post<KnowledgeBase>("/knowledge-bases", payload);
}

export async function getKnowledgeBaseStats(
  client: ApiClient,
  knowledgeBaseId: string,
): Promise<KnowledgeBaseStats> {
  if (MOCK_ENABLED) {
    return demoGetKnowledgeBaseStats(knowledgeBaseId);
  }
  return client.get<KnowledgeBaseStats>(`/knowledge-bases/${knowledgeBaseId}/stats`);
}
