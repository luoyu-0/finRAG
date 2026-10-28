/**
 * 制度问答页。
 *
 * 对应 docs/api/系统接口.md §6。页面覆盖三种状态：空闲、检索中、失败（可重试），
 * 结果区域展示回答正文、证据支持度、条文来源与追踪标识。
 */
import { useState } from "react";
import type { FormEvent } from "react";

import { ApiError } from "../../api/errors";
import { MOCK_ENABLED } from "../../api/mode";
import { askQuestion } from "../../api/qa";
import { apiClient } from "../../api/session";
import { AnswerText, hasCitationMarkers } from "../../components/AnswerText";
import { CitationList } from "../../components/CitationList";
import { EvidenceMeter } from "../../components/EvidenceMeter";
import { PageState } from "../../components/PageState";
import type { QuestionResponse } from "../../types/qa";

const MAX_LENGTH = 500;
const REQUEST_TIMEOUT_MS = 15_000;

const EXAMPLES = [
  "商业银行应如何管理流动性风险？",
  "压力测试结果不合格时应采取哪些措施？",
  ...(MOCK_ENABLED ? ["演示：无证据时如何回应？"] : []),
];

type Phase = "idle" | "loading" | "success" | "error";

function AnswerPanel({ result }: { result: QuestionResponse }) {
  const hasEvidence = result.evidence_support.level !== "none";
  // 后端在正文内嵌 [S1] 时用行内角标；未内嵌则回退为底部来源列表（契约 §6）。
  const inlineCitations = hasEvidence && hasCitationMarkers(result.answer);

  return (
    <div className="stack">
      <div className="stack stack--tight">
        <EvidenceMeter evidence={result.evidence_support} />
        <p className="faint">{result.evidence_support.explanation}</p>
      </div>

      {result.warnings.length > 0 ? (
        <output className="stack stack--tight qa__warnings">
          {result.warnings.map((warning) => (
            <span key={warning}>· {warning}</span>
          ))}
        </output>
      ) : null}

      {hasEvidence ? (
        inlineCitations ? (
          <AnswerText text={result.answer} citations={result.citations} />
        ) : (
          <p className="qa__answer-body">{result.answer}</p>
        )
      ) : (
        <p className="qa__no-evidence">{result.answer}</p>
      )}

      {inlineCitations ? (
        <p className="qa__cite-hint">
          正文中的角标可点击查看条文来源，共 {result.citations.length} 条。
        </p>
      ) : (
        <section className="qa__section">
          <h3 className="qa__section-title">条文来源（{result.citations.length}）</h3>
          <CitationList citations={result.citations} />
        </section>
      )}

      <p className="qa__trace">trace_id: {result.trace_id}</p>
    </div>
  );
}

export function QaPage() {
  const [question, setQuestion] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<QuestionResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const overLimit = question.length > MAX_LENGTH;
  const busy = phase === "loading";

  async function submit(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_LENGTH) {
      return;
    }

    setPhase("loading");
    setError(null);
    setResult(null);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await askQuestion(apiClient, { question: trimmed }, controller.signal);
      setResult(response);
      setPhase("success");
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError(0, "UNKNOWN_ERROR", "请求失败，请稍后重试。"),
      );
      setPhase("error");
    } finally {
      clearTimeout(timeout);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit(question);
  }

  function applyExample(example: string): void {
    setQuestion(example);
    void submit(example);
  }

  return (
    <div className="stack stack--section">
      <section className="card">
        <div className="card__header">
          <h2 className="card__title">提问</h2>
          <span className="faint">回答将附带条文来源与证据支持度</span>
        </div>

        <div className="card__body">
          <div className="stack">
            <form className="qa__form" onSubmit={handleSubmit}>
              <label className="sr-only" htmlFor="qa-question">
                问题
              </label>
              <textarea
                id="qa-question"
                className="qa__textarea"
                value={question}
                maxLength={MAX_LENGTH + 200}
                placeholder="例如：商业银行应如何管理流动性风险？"
                onChange={(event) => setQuestion(event.target.value)}
              />

              <div className="qa__meta">
                <span className={overLimit ? "qa__counter qa__counter--over" : "qa__counter"}>
                  {question.length} / {MAX_LENGTH}
                </span>
                <button
                  type="submit"
                  className="btn"
                  disabled={busy || !question.trim() || overLimit}
                >
                  {busy ? "检索中…" : "提问"}
                </button>
              </div>
            </form>

            <div className="stack stack--tight">
              <span className="faint">试一试：</span>
              <div className="qa__examples">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    className="qa__example"
                    disabled={busy}
                    onClick={() => applyExample(example)}
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card__header">
          <h2 className="card__title">回答</h2>
          {result ? <span className="faint">共 {result.citations.length} 条引用</span> : null}
        </div>

        <div className="card__body">
          {phase === "idle" ? (
            <PageState
              title="还没有提问"
              description="输入问题后，系统会在有效期内的制度中检索证据，并给出带条文引用的回答。"
            />
          ) : null}

          {phase === "loading" ? (
            <PageState
              kind="loading"
              title="正在检索制度条文…"
              description="检索、融合与生成的目标耗时不超过 2 秒。"
            />
          ) : null}

          {phase === "error" && error ? (
            <PageState
              kind="error"
              title="提问失败"
              description={error.message}
              errorCode={error.code}
              actions={
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => void submit(question)}
                >
                  重试
                </button>
              }
            />
          ) : null}

          {phase === "success" && result ? <AnswerPanel result={result} /> : null}
        </div>
      </section>
    </div>
  );
}
