"""RAG 核心流程异常。"""


class RagError(Exception):
    """RAG 模块基础异常。"""


class RagConfigurationError(RagError):
    """核心流程缺少必要 Provider。"""


class RetrievalUnavailableError(RagError):
    """所有检索通道均不可用。"""


class GenerationFailedError(RagError):
    """生成 Provider 调用失败。"""


class GenerationContractError(RagError):
    """生成结果违反引用等结构化契约。"""
