/**
 * 页面状态占位：加载、空数据、失败（含超时）。
 *
 * 协作规范要求页面处理加载、空数据、失败与超时场景（docs/开发分工.md §5.1），
 * 统一在此组件中呈现，避免每个页面各写一套。
 */
import type { ReactNode } from "react";

export type PageStateKind = "loading" | "empty" | "error";

const KIND_ICON: Record<PageStateKind, string> = {
  loading: "…",
  empty: "∅",
  error: "!",
};

interface PageStateProps {
  kind?: PageStateKind;
  title: string;
  description?: string;
  /** 失败时的稳定错误码，便于对照契约中的错误码表。 */
  errorCode?: string;
  actions?: ReactNode;
}

export function PageState({
  kind = "empty",
  title,
  description,
  errorCode,
  actions,
}: PageStateProps) {
  const className = kind === "error" ? "state state--error" : "state";

  return (
    <div className={className} role={kind === "error" ? "alert" : "status"}>
      <div className="state__icon" aria-hidden="true">
        {KIND_ICON[kind]}
      </div>
      <p className="state__title">{title}</p>
      {description ? <p className="state__desc">{description}</p> : null}
      {errorCode ? <p className="state__code">{errorCode}</p> : null}
      {actions ? <div className="state__actions">{actions}</div> : null}
    </div>
  );
}
