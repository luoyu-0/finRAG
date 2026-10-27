/** 收藏接口封装，对应 docs/api/系统接口.md §9.4–§9.6。 */
import type { ApiClient } from "./client";
import { demoAddFavorite, demoListFavorites, demoRemoveFavorite } from "./demo";
import { MOCK_ENABLED } from "./mode";
import type { Page, PageQuery } from "../types/api";
import type { FavoriteRecord } from "../types/history";

export async function listFavorites(
  client: ApiClient,
  query: PageQuery = {},
): Promise<Page<FavoriteRecord>> {
  if (MOCK_ENABLED) {
    return demoListFavorites(query);
  }
  return client.get<Page<FavoriteRecord>>("/favorites", {
    query: { page: query.page, page_size: query.page_size },
  });
}

export async function addFavorite(client: ApiClient, qaId: string): Promise<FavoriteRecord> {
  if (MOCK_ENABLED) {
    return demoAddFavorite(qaId);
  }
  return client.post<FavoriteRecord>("/favorites", { qa_id: qaId });
}

export async function removeFavorite(client: ApiClient, favoriteId: string): Promise<void> {
  if (MOCK_ENABLED) {
    return demoRemoveFavorite(favoriteId);
  }
  await client.delete<void>(`/favorites/${favoriteId}`);
}
