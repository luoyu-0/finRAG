import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EvidenceMeter } from "../../src/components/EvidenceMeter";
import type { EvidenceSupport } from "../../src/types/qa";

function makeEvidence(overrides: Partial<EvidenceSupport> = {}): EvidenceSupport {
  return {
    score: 0.82,
    level: "strong",
    method: "retrieval_evidence_v1",
    explanation: "表示当前检索证据对回答的支持程度，不是答案正确概率。",
    ...overrides,
  };
}

describe("EvidenceMeter", () => {
  it("按等级展示中文文案与百分比", () => {
    render(<EvidenceMeter evidence={makeEvidence()} />);

    expect(screen.getByText(/证据支持度：较强/)).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();
  });

  it("分数超过 1 时截断为 100%", () => {
    render(<EvidenceMeter evidence={makeEvidence({ score: 1.7 })} />);

    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("分数为负时截断为 0%", () => {
    render(<EvidenceMeter evidence={makeEvidence({ score: -0.4, level: "none" })} />);

    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("无依据等级使用对应文案", () => {
    render(<EvidenceMeter evidence={makeEvidence({ score: 0, level: "none" })} />);

    expect(screen.getByText(/证据支持度：无依据/)).toBeInTheDocument();
  });

  it("装饰性进度条不进入无障碍树，信息由文本承担", () => {
    const { container } = render(<EvidenceMeter evidence={makeEvidence()} />);

    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(container.querySelector(".evidence__track")).toHaveAttribute("aria-hidden", "true");
  });
});
