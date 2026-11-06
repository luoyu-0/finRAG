"""使用 LangChain 调用 DeepSeek，保持生成端口可替换。"""

from __future__ import annotations

import json

from langchain_core.messages import AIMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableLambda
from langchain_deepseek import ChatDeepSeek
from openai import LengthFinishReasonError

from app.domain.rag import ContextPackage, GeneratorOutput, RagQuery


SYSTEM_PROMPT = (
    "你是金融制度问答助手。仅依据给定证据回答；不得补造事实或来源。"
    "请输出 JSON 对象，格式为 "
    '{"answer":"Markdown 格式回答","citation_labels":["S1"]}。'
    "answer 必须是简体中文 Markdown 正文，不要代码围栏或 HTML。"
    "首段使用 `### 结论` 直接回答问题；有多项限额、条件或例外时，"
    "再用有意义的小标题和 `- ` 列表逐项说明，关键金额与适用范围可加粗。"
    "简短问题只给直接答案，不扩展无关信息；不要把多项规定挤成一整段。"
    "每条依据证据得出的规定后面必须紧跟行内引用标记，例如 `[S1]`；"
    "同一处用到多条证据时写成 `[S1][S2]`，标记只能使用证据列表中出现过的编号。"
    "不要在 answer 末尾另列来源清单，来源由行内标记表示。"
    "citation_labels 必须包含 answer 中出现的全部标记，"
    "且只能包含实际用于回答的证据标签。"
    "证据与问题无关或不足以回答时，说明依据不足，"
    "citation_labels 返回空数组；不要引用无关材料。"
)


class DeepSeekAnswerGenerator:
    """通过提示模板、异步聊天模型与严格解析链生成回答。"""

    def __init__(self, api_key: str, *, model: str = "deepseek-flash") -> None:
        if not api_key.strip():
            raise ValueError("DEEPSEEK_API_KEY 不能为空")
        prompt = ChatPromptTemplate.from_messages([
            SystemMessage(content=SYSTEM_PROMPT),
            ("human", "问题：{question}\n\n证据：\n{context}"),
        ])
        llm = ChatDeepSeek(
            api_key=api_key,
            model=model,
            timeout=45,
            max_retries=0,
            max_tokens=1200,
            extra_body={"thinking": {"type": "disabled"}},
        ).bind(response_format={"type": "json_object"})
        self._chain = prompt | llm | RunnableLambda(self._parse_response)

    @staticmethod
    def _parse_response(message: AIMessage) -> dict:
        # 不使用宽松 JSON 修复，防止将截断的金额或条文当成完整答案。
        if message.response_metadata.get("finish_reason") != "stop":
            raise ValueError("生成结果未完整结束")
        if not isinstance(message.content, str):
            raise ValueError("生成结果格式无效")
        result = json.loads(message.content)
        if not isinstance(result, dict):
            raise ValueError("生成结果格式无效")
        if not isinstance(result.get("answer"), str) or not isinstance(result.get("citation_labels"), list):
            raise ValueError("生成结果格式无效")
        return result

    async def generate(self, query: RagQuery, context: ContextPackage) -> GeneratorOutput:
        try:
            result = await self._chain.ainvoke({"question": query.question, "context": context.text})
        except LengthFinishReasonError as exc:
            raise ValueError("生成结果未完整结束") from exc
        labels = {item.label for item in context.items}
        citations = result["citation_labels"]
        if any(not isinstance(label, str) or label not in labels for label in citations):
            raise ValueError("生成结果包含未知证据标签")
        return GeneratorOutput(answer=result["answer"], citation_labels=tuple(citations))
