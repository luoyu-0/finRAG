/**
 * 导入任务进度。
 *
 * 契约 §8.6 要求前端按 `state` 与 `stage` 渲染，**不硬编码枚举之外的取值**：
 * 遇到未知值时退化为通用文案与通用进度条，避免后端新增阶段时前端报错。
 */
import { Badge } from "./Badge";
import type { BadgeVariant } from "./Badge";
import type { IngestionTask } from "../types/knowledge";

const STATE_LABEL: Record<string, string> = {
  queued: "排队中",
  processing: "处理中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const STATE_VARIANT: Record<string, BadgeVariant> = {
  queued: "neutral",
  processing: "info",
  succeeded: "success",
  failed: "danger",
  cancelled: "neutral",
};

const STAGE_LABEL: Record<string, string> = {
  received: "接收文件",
  extracting: "提取正文",
  ocr: "OCR 识别",
  normalizing: "清洗排版",
  chunking: "条文切分",
  embedding: "向量化",
  indexing: "写入索引",
  completed: "已完成",
};

function label(map: Record<string, string>, key: string, fallback: string): string {
  return map[key] ?? fallback;
}

export function TaskProgress({ task }: { task: IngestionTask }) {
  const clamped = Math.min(1, Math.max(0, task.progress));
  const percent = Math.round(clamped * 100);
  const stageText = label(STAGE_LABEL, task.stage, "处理中");

  return (
    <div className="task">
      <div className="task__head">
        <span className="task__id">{task.id}</span>
        <Badge variant={STATE_VARIANT[task.state] ?? "neutral"}>
          {label(STATE_LABEL, task.state, "未知状态")}
        </Badge>
        <span className="task__stage">{stageText}</span>
      </div>

      <div className="evidence__track" aria-hidden="true">
        <div className="evidence__fill" style={{ width: `${String(percent)}%` }} />
      </div>

      <div className="task__meta">
        <span>
          {percent}% · 第 {task.page_processed}/{task.page_total} 页 · 第 {task.attempt} 次尝试
        </span>
        <span className="faint">{task.document_id}</span>
      </div>

      {task.warnings.length > 0 ? (
        <output className="task__warnings">
          {task.warnings.map((warning) => (
            <span key={warning}>· {warning}</span>
          ))}
        </output>
      ) : null}

      {task.error ? (
        <p className="task__error" role="alert">
          {task.error.error_code}：{task.error.message}
        </p>
      ) : null}
    </div>
  );
}
