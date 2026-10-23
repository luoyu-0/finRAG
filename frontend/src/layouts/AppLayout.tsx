/**
 * 应用外壳：左侧导航 + 顶部信息栏 + 内容区。
 *
 * 导航中未实现的模块显式标注「待实现」，避免使用者以为功能缺失是缺陷。
 */
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { Badge } from "../components/Badge";
import { useAuth } from "../stores/auth";

interface NavItem {
  to: string;
  label: string;
  enabled: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/qa", label: "制度问答", enabled: true },
  { to: "/knowledge", label: "知识库", enabled: false },
  { to: "/history", label: "问答历史", enabled: false },
  { to: "/favorites", label: "我的收藏", enabled: false },
];

const ROLE_TEXT = { admin: "管理员", user: "普通用户" } as const;

export function AppLayout() {
  const { user, logout, mockMode } = useAuth();
  const location = useLocation();

  const current = NAV_ITEMS.find((item) => location.pathname.startsWith(item.to));

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <span className="app-brand__name">finRAG</span>
          <span className="app-brand__sub">金融制度知识问答系统</span>
        </div>

        <nav className="app-nav" aria-label="主导航">
          {NAV_ITEMS.map((item) =>
            item.enabled ? (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  isActive ? "app-nav__item app-nav__item--active" : "app-nav__item"
                }
              >
                {item.label}
              </NavLink>
            ) : (
              <span key={item.to} className="app-nav__item app-nav__item--disabled">
                {item.label}
                <span className="app-nav__hint">待实现</span>
              </span>
            ),
          )}
        </nav>

        <div className="app-sidebar__footer">
          条文溯源 · 证据支持度
          <br />
          响应时间目标 ≤ 2 秒
        </div>
      </aside>

      <div className="app-main">
        <header className="app-header">
          <span className="app-header__title">{current?.label ?? "金融制度问答"}</span>

          <div className="app-header__right">
            {mockMode ? <Badge variant="warning">演示数据</Badge> : null}
            {user ? (
              <span className="app-user">
                {user.display_name}
                <Badge variant={user.role === "admin" ? "info" : "neutral"}>
                  {ROLE_TEXT[user.role]}
                </Badge>
              </span>
            ) : null}
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void logout()}>
              退出登录
            </button>
          </div>
        </header>

        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
