/**
 * 面包屑导航。
 *
 * 用于知识库 → 知识库详情 → 文档正文这条层级链路：让用户随时看清当前位置，
 * 并能直接点击任意上级回退。
 */
import { Link } from "react-router-dom";

export interface BreadcrumbItem {
  label: string;
  /** 最后一项（当前位置）不传 `to`，其余层级传上级地址。 */
  to?: string;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <nav className="breadcrumb" aria-label="面包屑">
      <ol className="breadcrumb__list">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li className="breadcrumb__item" key={`${String(index)}-${item.label}`}>
              {item.to === undefined || isLast ? (
                <span
                  className={isLast ? "breadcrumb__current" : "breadcrumb__text"}
                  aria-current={isLast ? "page" : undefined}
                >
                  {item.label}
                </span>
              ) : (
                <Link className="breadcrumb__link" to={item.to}>
                  {item.label}
                </Link>
              )}
              {isLast ? null : (
                <span className="breadcrumb__sep" aria-hidden="true">
                  ›
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
