/**
 * 列表页通用加载器。
 *
 * 把「请求 → 加载态 → 错误态 → 重试」抽到一处，六个页面共用，避免各自重复实现。
 *
 * 使用约定：
 * - `fetcher` 必须用 `useCallback` 保持引用稳定，查询条件作为它的依赖；
 *   条件变化时 fetcher 标识随之变化，effect 自动重新请求。
 * - 默认行为：重新请求时先进入加载态，由页面决定展示骨架还是保留旧数据。
 * - 翻页、筛选这类「只更新局部」的场景传 `{ keepData: true }`，旧数据保留在
 *   `data` 中，页面可以用 `loading` 做局部忙碌提示，而不是整块替换成加载态。
 * - 删除、编辑成功后用 `setData` 就地更新，避免重新请求导致整页重刷。
 */
import { useCallback, useEffect, useState } from "react";

import { ApiError } from "../api/errors";

export interface LoaderOptions {
  /** 重新请求时保留上一次的数据，避免分页或筛选时整块界面闪成加载态。 */
  keepData?: boolean;
}

export type LoaderUpdater<T> = T | null | ((previous: T | null) => T | null);

export interface LoaderResult<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** 用当前条件重新请求。 */
  reload: () => void;
  /** 修改查询条件前调用，立即进入加载态。 */
  beginLoad: () => void;
  /** 不进入加载态地刷新，用于轮询等场景。 */
  refresh: () => void;
  /** 就地更新数据，用于删除、编辑等不需要重新请求的场景。 */
  setData: (updater: LoaderUpdater<T>) => void;
}

interface LoaderState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
}

export function useLoader<T>(
  fetcher: () => Promise<T>,
  options: LoaderOptions = {},
): LoaderResult<T> {
  const keepData = options.keepData ?? false;
  const [state, setState] = useState<LoaderState<T>>({
    data: null,
    error: null,
    loading: true,
  });

  const run = useCallback(async () => {
    // 条件变化时立即标记加载中，但保留旧数据供 `keepData` 场景继续展示。
    setState((previous) => ({ ...previous, loading: true }));
    try {
      const data = await fetcher();
      setState({ data, error: null, loading: false });
    } catch (caught: unknown) {
      setState((previous) => ({
        data: keepData ? previous.data : null,
        error:
          caught instanceof ApiError
            ? caught
            : new ApiError(0, "UNKNOWN_ERROR", "请求失败，请稍后重试。"),
        loading: false,
      }));
    }
  }, [fetcher, keepData]);

  useEffect(() => {
    // run 是异步函数：条件变化后的 setState 只发生在 await 之后，
    // 不会在 effect 同步阶段触发级联渲染。规则在此处为保守误判。
    // oxlint-disable-next-line react/set-state-in-effect
    void run();
  }, [run]);

  const reload = useCallback(() => {
    setState((previous) => ({ ...previous, loading: true, error: null }));
    void run();
  }, [run]);

  const beginLoad = useCallback(() => {
    setState((previous) => ({ ...previous, loading: true, error: null }));
  }, []);

  const refresh = useCallback(() => {
    void run();
  }, [run]);

  const setData = useCallback((updater: LoaderUpdater<T>) => {
    setState((previous) => ({
      ...previous,
      data:
        typeof updater === "function"
          ? (updater as (current: T | null) => T | null)(previous.data)
          : updater,
    }));
  }, []);

  return {
    data: state.data,
    error: state.error,
    loading: state.loading,
    reload,
    beginLoad,
    refresh,
    setData,
  };
}
