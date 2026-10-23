/**
 * 鉴权状态容器。
 *
 * 采用 React Context 而不是额外状态库，符合「最小改动」原则：
 * 当前只有会话这一份跨页面状态，引入全局状态库没有收益。
 *
 * Access Token 只保存在内存中（见 ../api/session.ts），刷新页面后依靠
 * Refresh Cookie 恢复会话；Mock 模式没有 Cookie，因此刷新后需要重新登录。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { fetchCurrentUser, login as loginRequest, logout as logoutRequest } from "../api/auth";
import { MOCK_ENABLED } from "../api/mock";
import { apiClient, setAccessToken, setUnauthorizedHandler } from "../api/session";
import type { User } from "../types/auth";

export type AuthStatus = "initializing" | "anonymous" | "authenticated";

export interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  /** 是否处于演示数据模式，界面据此显示标识。 */
  mockMode: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("initializing");

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus("anonymous");
  }, []);

  // 收到 401 时由 HTTP 客户端回调清理会话，避免各页面各自处理。
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession();
    });
    return () => {
      setUnauthorizedHandler(null);
    };
  }, [clearSession]);

  // 会话恢复：真实模式下用 Refresh Cookie 换取新的 Access Token 后再取当前用户。
  useEffect(() => {
    let cancelled = false;

    async function restore(): Promise<void> {
      if (MOCK_ENABLED) {
        if (!cancelled) {
          setStatus("anonymous");
        }
        return;
      }
      try {
        const refreshed = await apiClient.post<{ access_token: string }>("/auth/refresh");
        setAccessToken(refreshed.access_token);
        const current = await fetchCurrentUser(apiClient, refreshed.access_token);
        if (!cancelled) {
          setUser(current);
          setStatus("authenticated");
        }
      } catch {
        if (!cancelled) {
          clearSession();
        }
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  const login = useCallback(async (username: string, password: string) => {
    const result = await loginRequest(apiClient, { username, password });
    setAccessToken(result.access_token);
    setUser(result.user);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutRequest(apiClient);
    } finally {
      // 与 clearSession 等价；此处内联是为了让依赖数组保持为空，
      // 避免 React Compiler 判定 clearSession 为多余依赖。
      setAccessToken(null);
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, mockMode: MOCK_ENABLED, login, logout }),
    [user, status, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth 必须在 AuthProvider 内使用");
  }
  return context;
}
