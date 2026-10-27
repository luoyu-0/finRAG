/**
 * 演示数据开关。
 *
 * - 单元测试（`MODE === "test"`）自动启用演示数据，不依赖真实后端；
 * - 开发预览可用 `VITE_DEMO=1` 临时启用，用于在后端业务接口尚未实现时查看界面；
 * - **正式构建不带任何演示数据**，全部调用真实接口。
 */
export const MOCK_ENABLED = import.meta.env.MODE === "test" || import.meta.env.VITE_DEMO === "1";
