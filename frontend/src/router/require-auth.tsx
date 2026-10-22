/**
 * 路由守卫。
 *
 * 只改善交互：未登录时跳转到登录页。**真正的授权由后端执行**，
 * 前端隐藏入口不构成权限控制（见 docs/architecture/系统架构.md §5.4）。
 */
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { PageState } from "../components/PageState";
import { useAuth } from "../stores/auth";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "initializing") {
    return <PageState kind="loading" title="正在恢复会话…" description="请稍候。" />;
  }

  if (status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
