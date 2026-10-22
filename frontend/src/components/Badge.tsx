/** 徽标。用于制度状态、证据等级、任务状态等等级化信息的统一呈现。 */
import type { ReactNode } from "react";

export type BadgeVariant = "neutral" | "info" | "success" | "warning" | "danger";

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
}

export function Badge({ variant = "neutral", children }: BadgeProps) {
  return <span className={`badge badge--${variant}`}>{children}</span>;
}
