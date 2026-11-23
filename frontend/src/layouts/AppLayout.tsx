/**
 * 应用外壳：左侧导航 + 顶部信息栏 + 内容区。
 *
 * 导航项按角色过滤：文档导入仅管理员可见。**这只是交互优化**，
 * 真实权限由后端在接口层校验（见 docs/api/系统接口.md §1.2）。
 *
 * 导航高亮是一块独立的滑动底色（`.app-nav__indicator`）：切换栏目时它从旧位置
 * 移到新位置，宽度跟随目标文字，落位带轻微回弹；文字本身不参与位移动画。
 */
import { useLayoutEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { Badge } from "../components/Badge";
import { useAuth } from "../stores/auth";

interface NavItem {
  to: string;
  label: string;
  /** 仅管理员可见。 */
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/qa", label: "制度问答" },
  { to: "/knowledge", label: "知识库" },
  { to: "/import", label: "文档导入", adminOnly: true },
  { to: "/history", label: "问答历史" },
  { to: "/favorites", label: "我的收藏" },
];

const ROLE_TEXT = { admin: "管理员", user: "普通用户" } as const;

interface IndicatorBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function AppLayout() {
  const { user, logout, mockMode } = useAuth();
  const location = useLocation();
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const visibleItems = NAV_ITEMS.filter(
    (item) => item.adminOnly !== true || user?.role === "admin",
  );
  const current = NAV_ITEMS.find((item) => location.pathname.startsWith(item.to));

  const navRef = useRef<HTMLElement | null>(null);
  const [indicator, setIndicator] = useState<IndicatorBox | null>(null);
  /** 首次测量完成后再开启过渡，避免高亮块从左上角飞入。 */
  const [animated, setAnimated] = useState(false);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (nav === null) {
      return;
    }

    const measure = (): void => {
      const active = nav.querySelector<HTMLElement>(".app-nav__item--active");
      setIndicator(
        active === null
          ? null
          : {
              x: active.offsetLeft,
              y: active.offsetTop,
              width: active.offsetWidth,
              height: active.offsetHeight,
            },
      );
    };

    measure();
    // 字体、窗口宽度、导航项增删或 active 类切换都会改变目标位置，需要重新测量。
    // 监听 class 变化即可覆盖路由切换，effect 因此不需要依赖 pathname。
    window.addEventListener("resize", measure);
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resizeObserver?.observe(nav);
    const mutationObserver =
      typeof MutationObserver === "undefined" ? null : new MutationObserver(measure);
    mutationObserver?.observe(nav, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    const fontsReady = document.fonts?.ready;
    if (fontsReady !== undefined) {
      fontsReady.then(measure).catch(() => undefined);
    }

    return () => {
      window.removeEventListener("resize", measure);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    if (indicator === null || animated) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      setAnimated(true);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [indicator, animated]);

  const navItems = visibleItems.map((item) => (
    <NavLink
      key={item.to}
      to={item.to}
      className={({ isActive }) =>
        isActive ? "app-nav__item app-nav__item--active" : "app-nav__item"
      }
    >
      {item.label}
    </NavLink>
  ));

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <img
            className="app-brand__logo"
            src="/brand/sunyard-logo.webp"
            alt="信雅达 SUNYARD"
            width={757}
            height={200}
          />
          <span className="app-brand__sub">金融制度知识问答系统</span>
        </div>

        <nav className="app-nav" aria-label="主导航" ref={navRef}>
          <span
            aria-hidden="true"
            className={
              animated ? "app-nav__indicator app-nav__indicator--animated" : "app-nav__indicator"
            }
            style={
              indicator === null
                ? { opacity: 0, width: 0, height: 0 }
                : {
                    opacity: 1,
                    width: indicator.width,
                    height: indicator.height,
                    transform: `translate(${String(indicator.x)}px, ${String(indicator.y)}px)`,
                  }
            }
          />
          {navItems}
        </nav>

        <div className="app-sidebar__footer">
          条文溯源 · 证据支持度
          <br />
          首字响应目标 ≤ 2 秒
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
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setLogoutError(null);
                void logout().catch(() => setLogoutError("退出失败，请重试。"));
              }}
            >
              退出登录
            </button>
            {logoutError ? <span role="alert">{logoutError}</span> : null}
          </div>
        </header>

        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
