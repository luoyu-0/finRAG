/** 单元测试单独启用演示数据；开发与生产构建调用真实接口。 */
export const MOCK_ENABLED = import.meta.env.MODE === "test";
