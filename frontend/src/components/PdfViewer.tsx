/**
 * 页面内 PDF 阅读器。
 *
 * 为什么不用浏览器内置阅读器：把 PDF 直接交给 `iframe` 依赖浏览器自带的阅读器插件，
 * 遇到较窄的窗口、企业策略禁用内置阅读器或扫描页首次绘制失败时，界面上只会留下一块空白，
 * 前端无法感知失败也无法给出替代方案。这里改用 pdf.js 在页面内渲染画布：
 * - PDF.js 加载原文并按页渲染，已加载的页面可以直接重绘；
 * - 打开时直接定位到引用页，并提供页码跳转、缩放与适应宽度；
 * - 加载或渲染失败时通知正文页展示分块摘录。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
// pdf.js 的 worker 必须单独打包成静态资源，`?url` 由 Vite 负责生成地址。
// oxlint-disable-next-line import/default
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

const MIN_SCALE = 0.4;
const MAX_SCALE = 4;
const SCALE_STEP = 1.25;

export interface PdfViewerProps {
  /** 带短时票据的原文地址（契约 §8.3.2）。 */
  src: string;
  /** 打开时定位到的页码，通常是被引条文所在页。 */
  initialPage?: number;
  title: string;
  onError: (message: string) => void;
}

export function PdfViewer({ src, initialPage, title, onError }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const initialPageRef = useRef(initialPage ?? 1);
  /** 当前实际渲染比例；「适应宽度」下放大/缩小以它为基准。 */
  const renderedScaleRef = useRef(1);

  // 只在文档加载时读取初始页，之后由阅读器自己的翻页状态接管。
  useEffect(() => {
    initialPageRef.current = initialPage ?? 1;
  }, [initialPage]);

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState<number | "fit">("fit");
  const [containerWidth, setContainerWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pageInput, setPageInput] = useState("");

  const clampPage = useCallback(
    (value: number, total: number) => Math.min(Math.max(Math.trunc(value), 1), Math.max(total, 1)),
    [],
  );

  // 跟随容器宽度，`fit` 模式据此计算缩放比例。
  useEffect(() => {
    const element = wrapRef.current;
    if (element === null) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) {
        setContainerWidth(width);
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let loadingTask: ReturnType<typeof getDocument> | undefined;
    async function load() {
      loadingTask = getDocument({ url: src, withCredentials: false });
      const loaded = await loadingTask.promise;
      if (alive) {
        setDoc(loaded);
        setPageCount(loaded.numPages);
        setPageNumber(clampPage(initialPageRef.current, loaded.numPages));
        setLoading(false);
      }
    }
    void load().catch(() => {
      if (alive) {
        onError("PDF 原文加载失败。");
      }
    });

    return () => {
      alive = false;
      void loadingTask?.destroy();
    };
  }, [src, clampPage, onError]);

  // 渲染当前页；页码、缩放或容器宽度变化都会重绘。
  useEffect(() => {
    if (doc === null) {
      return;
    }
    let cancelled = false;
    let renderTask: RenderTask | null = null;

    const render = async (): Promise<void> => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) {
        return;
      }
      const base = page.getViewport({ scale: 1 });
      const available = containerWidth > 0 ? containerWidth : base.width;
      const targetScale =
        scale === "fit"
          ? Math.max(MIN_SCALE, (available - 2) / base.width)
          : Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE);
      renderedScaleRef.current = targetScale;
      const viewport = page.getViewport({ scale: targetScale });
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d") ?? null;
      if (canvas === null || context === null) {
        onError("当前浏览器无法绘制 PDF 页面。");
        return;
      }

      // 按设备像素比放大画布，避免高分屏发虚。
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${String(Math.floor(viewport.width))}px`;
      canvas.style.height = `${String(Math.floor(viewport.height))}px`;

      renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      await renderTask.promise;
    };

    void render().catch(() => {
      // 翻页或缩放时的取消属于正常流程，不提示错误。
      if (!cancelled) {
        onError("PDF 页面渲染失败。");
      }
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageNumber, scale, containerWidth, onError]);

  function goToPage(next: number): void {
    if (pageCount === 0) {
      return;
    }
    setPageNumber(clampPage(next, pageCount));
  }

  function handleJump(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsed = Number.parseInt(pageInput, 10);
    if (Number.isNaN(parsed)) {
      return;
    }
    goToPage(parsed);
    setPageInput("");
  }

  const zoomLabel = scale === "fit" ? "适应宽度" : `${String(Math.round(scale * 100))}%`;

  return (
    <div className="pdf-viewer">
      <div className="pdf-viewer__bar">
        <div className="pdf-viewer__group">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={pageNumber <= 1}
            onClick={() => {
              goToPage(pageNumber - 1);
            }}
          >
            上一页
          </button>
          <form className="pdf-viewer__jump" onSubmit={handleJump}>
            <label className="sr-only" htmlFor="pdf-page">
              跳转到指定页
            </label>
            <input
              id="pdf-page"
              className="field__input pdf-viewer__input"
              inputMode="numeric"
              placeholder="页码"
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
            />
            <button type="submit" className="btn btn--ghost btn--sm">
              跳转
            </button>
          </form>
          <span className="faint">
            第 {String(pageNumber)} / {String(pageCount)} 页
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={pageCount === 0 || pageNumber >= pageCount}
            onClick={() => {
              goToPage(pageNumber + 1);
            }}
          >
            下一页
          </button>
        </div>

        <div className="pdf-viewer__group">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            aria-label="缩小"
            onClick={() => {
              const current = scale === "fit" ? renderedScaleRef.current : scale;
              setScale(Math.max(MIN_SCALE, current / SCALE_STEP));
            }}
          >
            −
          </button>
          <span className="faint">{zoomLabel}</span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            aria-label="放大"
            onClick={() => {
              const current = scale === "fit" ? renderedScaleRef.current : scale;
              setScale(Math.min(MAX_SCALE, current * SCALE_STEP));
            }}
          >
            +
          </button>
          {scale === "fit" ? null : (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setScale("fit")}
            >
              适应宽度
            </button>
          )}
        </div>
      </div>

      <div ref={wrapRef} className="pdf-viewer__canvas-wrap" aria-busy={loading}>
        {loading ? <p className="pdf-viewer__hint">正在加载 PDF…</p> : null}
        <canvas
          ref={canvasRef}
          className={loading ? "pdf-viewer__canvas--hidden" : "pdf-viewer__canvas"}
          aria-label={`${title} 第 ${String(pageNumber)} 页`}
        />
      </div>
    </div>
  );
}
