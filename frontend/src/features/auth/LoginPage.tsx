/**
 * 登录页。
 *
 * 与 docs/api/系统接口.md §3.1 对应。演示数据模式下会直接给出可用账户，
 * 便于评审快速进入问答流程。
 */
import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { ApiError } from "../../api/errors";
import { PageState } from "../../components/PageState";
import { useAuth } from "../../stores/auth";

interface LocationState {
  from?: string;
}

export function LoginPage() {
  const { status, login, mockMode } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === "authenticated") {
    return <Navigate to="/qa" replace />;
  }

  if (status === "initializing") {
    return <PageState kind="loading" title="正在恢复会话…" description="请稍候。" />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(username.trim(), password);
      const state = location.state as LocationState | null;
      navigate(state?.from ?? "/qa", { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "登录失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <aside className="auth-aside">
        <div className="stack stack--tight">
          <p className="eyebrow eyebrow--inverse">finRAG</p>
          <p className="auth-aside__title">
            金融制度
            <br />
            知识问答系统
          </p>
        </div>

        <p className="auth-aside__desc">
          面向银行监管政策、证券行业规范与保险制度等公开材料，提供条文溯源、证据支持度评估与制度时效性过滤。
        </p>

        <ul className="auth-aside__points">
          <li>· 混合检索：关键词与向量双通道，按排名融合</li>
          <li>· 每条回答附带可定位到页码与条文的引用</li>
          <li>· 制度有效状态作为检索过滤条件，而非交给模型判断</li>
        </ul>
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          <h1 className="auth-card__title">登录</h1>
          <p className="auth-card__desc">请使用分配给你的账户登录系统。</p>

          <form className="stack auth-card__form" onSubmit={(event) => void handleSubmit(event)}>
            <label className="field">
              <span className="field__label">用户名</span>
              <input
                className="field__input"
                name="username"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </label>

            <label className="field">
              <span className="field__label">密码</span>
              <input
                className="field__input"
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>

            {error ? (
              <p className="field__error" role="alert">
                {error}
              </p>
            ) : null}

            <button type="submit" className="btn btn--block" disabled={submitting}>
              {submitting ? "登录中…" : "登录"}
            </button>
          </form>

          {mockMode ? <div className="auth-card__footer">当前为单元测试演示数据模式。</div> : null}
        </div>
      </main>
    </div>
  );
}
