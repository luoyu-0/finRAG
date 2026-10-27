"""DeepSeek 问答生成适配器。"""

from __future__ import annotations

import asyncio
import json
from urllib.request import Request, urlopen

from app.domain.rag import ContextPackage, GeneratorOutput, RagQuery


class DeepSeekAnswerGenerator:
    """通过 HTTP 调用 DeepSeek，保持生成端口可替换。"""

    def __init__(self, api_key: str, *, model: str = "deepseek-flash") -> None:
        if not api_key.strip():
            raise ValueError("DEEPSEEK_API_KEY 不能为空")
        self._api_key = api_key
        self._model = model

    async def generate(self, query: RagQuery, context: ContextPackage) -> GeneratorOutput:
        return await asyncio.to_thread(self._generate_sync, query, context)

    def _generate_sync(self, query: RagQuery, context: ContextPackage) -> GeneratorOutput:
        labels = {item.label for item in context.items}
        body = json.dumps(
            {
                "model": self._model,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "你是金融制度问答助手。仅依据给定证据回答；不得补造事实或来源。"
                            "请输出 JSON 对象，格式为 "
                            '{"answer":"Markdown 格式回答","citation_labels":["S1"]}。'
                            "answer 必须是简体中文 Markdown 正文，不要代码围栏或 HTML。"
                            "首段使用 `### 结论` 直接回答问题；有多项限额、条件或例外时，"
                            "再用有意义的小标题和 `- ` 列表逐项说明，关键金额与适用范围可加粗。"
                            "简短问题只给直接答案，不扩展无关信息；不要把多项规定挤成一整段。"
                            "来源只放在 citation_labels 中，不在 answer 末尾重复来源清单。"
                            "citation_labels 只能包含实际用于回答的证据标签。"
                            "证据与问题无关或不足以回答时，说明依据不足，"
                            "citation_labels 返回空数组；不要引用无关材料。"
                        ),
                    },
                    {
                        "role": "user",
                        "content": f"问题：{query.question}\n\n证据：\n{context.text}",
                    },
                ],
                "response_format": {"type": "json_object"},
                "thinking": {"type": "disabled"},
                "max_tokens": 1200,
                "stream": False,
            },
            ensure_ascii=False,
        ).encode("utf-8")
        request = Request(
            "https://api.deepseek.com/chat/completions",
            data=body,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urlopen(request, timeout=45) as response:
            payload = json.load(response)
        choice = payload["choices"][0]
        if choice.get("finish_reason") != "stop":
            raise ValueError("生成结果未完整结束")
        result = json.loads(choice["message"]["content"])
        answer = result["answer"]
        citations = result["citation_labels"]
        if not isinstance(answer, str) or not isinstance(citations, list):
            raise ValueError("生成结果格式无效")
        if any(not isinstance(label, str) or label not in labels for label in citations):
            raise ValueError("生成结果包含未知证据标签")
        return GeneratorOutput(answer=answer, citation_labels=tuple(citations))
