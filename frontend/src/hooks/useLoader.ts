/**
 * 列表页通用加载器。
 *
 * 把「请求 → 加载态 → 错误态 → 重试」抽到一处，五个页面共用，避免各自重复实现。
 *
 * 使用约定：
 * - `fetcher` 必须用 `useCallback` 保持引用稳定，查询条件作为它的依赖；
 *   条件变化时 fetcher 标识随之变化，effect 自动重新请求。
 * - 修改查询条件前调用 `beginLoad()`，以便立即进入加载态而不是短暂显示旧数据。
 *
 * 这样 effect 内部不会同步调用 setState（setState 只发生在 await 之后），
 * 符合 React Compiler 对 effect 的要求。
 */
import { useCallback, useEffect, useState } from "react";

import { ApiError } from "../api/errors";

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
}

interface LoaderState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
}

export function useLoader<T>(fetcher: () => Promise<T>): LoaderResult<T> {
  const [state, setState] = useState<LoaderState<T>>({
    data: null,
    error: null,
    loading: true,
  });

  const run = useCallback(async () => {
    try {
      const data = await fetcher();
      setState({ data, error: null, loading: false });
    } catch (caught: unknown) {
      setState({
        data: null,
        error:
          caught instanceof ApiError
            ? caught
            : new ApiError(0, "UNKNOWN_ERROR", "请求失败，请稍后重试。"),
        loading: false,
      });
    }
  }, [fetcher]);

  useEffect(() => {
    // run 是异步函数：setState 只发生在 fetcher 的 await 之后，
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

  return {
    data: state.data,
    error: state.error,
    loading: state.loading,
    reload,
    beginLoad,
    refresh,
  };
}
