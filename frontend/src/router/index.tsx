/**
 * 路由定义。
 *
 * 主链路：登录 → 制度问答；此外提供知识库、文档导入、问答历史与收藏。
 * 各页面对应的接口契约见 docs/api/系统接口.md §7–§9。
 */
import { Navigate, Route, Routes } from "react-router-dom";

import { LoginPage } from "../features/auth/LoginPage";
import { ImportPage } from "../features/documents/ImportPage";
import { FavoritesPage } from "../features/favorites/FavoritesPage";
import { HistoryPage } from "../features/history/HistoryPage";
import { KnowledgeDetailPage } from "../features/knowledge/KnowledgeDetailPage";
import { KnowledgePage } from "../features/knowledge/KnowledgePage";
import { QaPage } from "../features/qa/QaPage";
import { AppLayout } from "../layouts/AppLayout";
import { NotFoundPage } from "../pages/NotFoundPage";
import { RequireAuth } from "./require-auth";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/qa" replace />} />
        <Route path="qa" element={<QaPage />} />
        <Route path="knowledge" element={<KnowledgePage />} />
        <Route path="knowledge/:knowledgeBaseId" element={<KnowledgeDetailPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="favorites" element={<FavoritesPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
