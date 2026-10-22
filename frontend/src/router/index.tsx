/**
 * 路由定义。
 *
 * 当前只实现「制度问答」这一条主链路；知识库、历史与收藏的接口契约已在
 * docs/api/系统接口.md 中定义，页面待后续实现，导航中先置为不可用。
 */
import { Navigate, Route, Routes } from "react-router-dom";

import { LoginPage } from "../features/auth/LoginPage";
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
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
