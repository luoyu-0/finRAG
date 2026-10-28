import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TaskProgress } from "../../src/components/TaskProgress";
import type { IngestionTask } from "../../src/types/knowledge";

function makeTask(overrides: Partial<IngestionTask> = {}): IngestionTask {
  return {
    id: "task_001",
    document_id: "doc_001",
    version_id: null,
    state: "processing",
    stage: "ocr",
    progress: 0.45,
    page_total: 24,
    page_processed: 11,
    attempt: 1,
    queued_at: "2026-10-27T01:10:00Z",
    started_at: "2026-10-27T01:10:06Z",
    finished_at: null,
    warnings: [],
    error: null,
    created_by: "user_admin",
    ...overrides,
  };
}

describe("TaskProgress", () => {
  it("展示状态、阶段、百分比与页进度", () => {
    render(<TaskProgress task={makeTask()} />);

    expect(screen.getByText("处理中")).toBeInTheDocument();
    expect(screen.getByText("OCR 识别")).toBeInTheDocument();
    expect(screen.getByText(/45% · 第 11\/24 页 · 第 1 次尝试/)).toBeInTheDocument();
  });

  it("成功状态下展示已完成", () => {
    render(
      <TaskProgress
        task={makeTask({ state: "succeeded", stage: "completed", progress: 1, finished_at: "x" })}
      />,
    );

    // 状态徽标与阶段名都会显示「已完成」
    expect(screen.getAllByText("已完成").length).toBeGreaterThan(0);
    expect(screen.getByText(/100%/)).toBeInTheDocument();
  });

  it("失败时展示错误码与消息", () => {
    render(
      <TaskProgress
        task={makeTask({
          state: "failed",
          error: { error_code: "OCR_ENGINE_UNAVAILABLE", message: "OCR 引擎不可用" },
        })}
      />,
    );

    expect(screen.getByText("失败")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("OCR_ENGINE_UNAVAILABLE");
  });

  it("展示解析告警", () => {
    render(<TaskProgress task={makeTask({ warnings: ["第 3 页置信度较低"] })} />);

    expect(screen.getByText(/第 3 页置信度较低/)).toBeInTheDocument();
  });

  it("遇到未知枚举值时退化为通用文案而不报错", () => {
    // 后端新增阶段时前端不应崩溃（契约 §8.6）。
    const unknown = {
      ...makeTask(),
      state: "paused",
      stage: "rescanning",
    } as unknown as IngestionTask;

    render(<TaskProgress task={unknown} />);

    expect(screen.getByText("未知状态")).toBeInTheDocument();
    expect(screen.getByText("处理中")).toBeInTheDocument();
  });

  it("进度超出范围时被截断", () => {
    render(<TaskProgress task={makeTask({ progress: 3 })} />);

    expect(screen.getByText(/100%/)).toBeInTheDocument();
  });
});
