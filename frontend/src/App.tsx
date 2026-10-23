/** 应用根组件：只负责挂载路由表；鉴权状态由 AuthProvider 提供。 */
import { AppRoutes } from "./router";

export function App() {
  return <AppRoutes />;
}
