/** 问答历史接口封装，对应 docs/api/系统接口.md §9.1–§9.3。 */
import type { ApiClient } from "./client";
import { MOCK_ENABLED } from "./mode";
import type { Page, PageQuery } from "../types/api";
import type { QaRecord } from "../types/history";

export interface ListHistoryQuery extends PageQuery {
  q?: string;
  favorited?: boolean;
}

export async function listHistory(
  client: ApiClient,
  query: ListHistoryQuery = {},
): Promise<Page<QaRecord>> {
  if (MOCK_ENABLED) {
    const { demoListHistory } = await import("./demo");
    return demoListHistory(query);
  }
  return client.get<Page<QaRecord>>("/qa/history", {
    query: {
      page: query.page,
      page_size: query.page_size,
      q: query.q,
      favorited: query.favorited,
    },
  });
}

export async function deleteHistory(client: ApiClient, recordId: string): Promise<void> {
  if (MOCK_ENABLED) {
    const { demoDeleteHistory } = await import("./demo");
    return demoDeleteHistory(recordId);
  }
  await client.delete<void>(`/qa/history/${recordId}`);
}
