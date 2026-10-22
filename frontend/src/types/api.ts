/**
 * 通用接口类型。
 *
 * 与 docs/api/系统接口.md 对应：
 * - §1.1 分页约定 → `Page` / `PageQuery`
 */

/** 列表接口的统一响应包装（契约 §1.1）。 */
export interface Page<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
  has_next: boolean;
}

/** 列表接口的通用查询参数（契约 §1.1）。 */
export interface PageQuery {
  /** 从 1 开始的页码，默认 1。 */
  page?: number;
  /** 每页条数，取值 1–100，默认 20。 */
  page_size?: number;
}
