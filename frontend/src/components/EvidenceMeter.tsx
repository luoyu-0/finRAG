/**
 * 证据支持度展示。
 *
 * 契约中 `evidence_support` 的含义是「当前检索证据对回答的支持程度」，
 * **不是答案正确概率**，界面文案必须保持这一区分（见术语表与 AGENTS §8）。
 */
import type { EvidenceLevel, EvidenceSupport } from "../types/qa";
import { Badge } from "./Badge";
import type { BadgeVariant } from "./Badge";

const LEVEL_TEXT: Record<EvidenceLevel, string> = {
  none: "无依据",
  weak: "较弱",
  moderate: "中等",
  strong: "较强",
};

const LEVEL_VARIANT: Record<EvidenceLevel, BadgeVariant> = {
  none: "neutral",
  weak: "danger",
  moderate: "warning",
  strong: "success",
};

interface EvidenceMeterProps {
  evidence: EvidenceSupport;
}

export function EvidenceMeter({ evidence }: EvidenceMeterProps) {
  const clamped = Math.min(1, Math.max(0, evidence.score));
  const percent = Math.round(clamped * 100);

  return (
    <div className={`evidence evidence--${evidence.level}`}>
      <Badge variant={LEVEL_VARIANT[evidence.level]}>
        证据支持度：{LEVEL_TEXT[evidence.level]}
      </Badge>
      {/* 进度条是装饰性的：百分比已在旁边以文本呈现，因此不进入无障碍树。 */}
      <div className="evidence__track" aria-hidden="true">
        <div className="evidence__fill" style={{ width: `${String(percent)}%` }} />
      </div>
      <span className="evidence__value">{percent}%</span>
    </div>
  );
}
