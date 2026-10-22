/** 未匹配路由的兜底页面。 */
import { Link } from "react-router-dom";

import { PageState } from "../components/PageState";

export function NotFoundPage() {
  return (
    <PageState
      kind="error"
      title="页面不存在"
      description="请检查地址是否正确，或返回问答页面继续使用。"
      errorCode="404 NOT_FOUND"
      actions={
        <Link className="btn" to="/qa">
          返回制度问答
        </Link>
      }
    />
  );
}
