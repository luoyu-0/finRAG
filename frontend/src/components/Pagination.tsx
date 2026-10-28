/** 分页控件，配合契约 §1.1 的分页包装使用。 */
interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  hasNext: boolean;
  disabled?: boolean;
  onChange: (page: number) => void;
}

export function Pagination({
  page,
  pageSize,
  total,
  hasNext,
  disabled = false,
  onChange,
}: PaginationProps) {
  if (total === 0) {
    return null;
  }

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav className="pagination" aria-label="分页">
      <span className="pagination__info">
        第 {from}–{to} 条，共 {total} 条
      </span>

      <div className="pagination__actions">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={disabled || page <= 1}
          onClick={() => onChange(page - 1)}
        >
          上一页
        </button>
        <span className="pagination__page">第 {page} 页</span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={disabled || !hasNext}
          onClick={() => onChange(page + 1)}
        >
          下一页
        </button>
      </div>
    </nav>
  );
}
