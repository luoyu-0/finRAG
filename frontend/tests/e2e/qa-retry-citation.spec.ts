import { expect, test } from "@playwright/test";

import type { DocumentContent } from "../../src/types/knowledge";
import type { QuestionResponse } from "../../src/types/qa";

const frame = (event: "delta" | "error" | "done", data: object) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

test("流式回答失败后可重试并定位引用原文", async ({ page }) => {
  const question = "识别受益所有人时获取的信息应如何处理？";
  const excerpt = "金融机构应当依法予以保密。";
  const title = "受益所有人识别管理办法（测试样例）";
  const fullText = `第七条 ${excerpt}\n第八条 其他要求。`;
  const answer: QuestionResponse = {
    answer: `### 结论\n\n${excerpt}[S1]`,
    citations: [
      {
        label: "S1",
        knowledge_base_id: "default",
        document_id: "fixture-doc",
        version_id: "fixture-version",
        chunk_id: "fixture-chunk",
        title,
        page_number: null,
        article_number: "第七条",
        source_url: null,
        excerpt,
      },
    ],
    evidence_support: { score: 0.82, level: "strong", method: "fixture", explanation: "条文支持" },
    warnings: [],
    trace_id: "fixture-trace",
  };
  const content: DocumentContent = {
    id: "fixture-doc",
    knowledge_base_id: "default",
    title,
    file_name: "rule.txt",
    page_count: 0,
    policy_status: "active",
    source: "txt",
    has_file: true,
    text: fullText,
    blocks: [],
    anchor: {
      chunk_id: "fixture-chunk",
      article_number: "第七条",
      page_number: null,
      excerpt,
      start: fullText.indexOf(excerpt),
      end: fullText.indexOf(excerpt) + excerpt.length,
      located: true,
    },
  };

  await page.route("**/api/v1/**", async (route) => {
    switch (new URL(route.request().url()).pathname) {
      case "/api/v1/auth/refresh":
        return route.fulfill({ json: { access_token: "fixture-token" } });
      case "/api/v1/users/me":
        return route.fulfill({
          json: {
            id: "fixture-user",
            username: "tester",
            display_name: "测试用户",
            role: "user",
            status: "active",
          },
        });
      case "/api/v1/knowledge-bases/default":
        return route.fulfill({ json: { id: "default", name: "测试知识库" } });
      case "/api/v1/documents/fixture-doc/content":
        expect(new URL(route.request().url()).searchParams.get("chunk_id")).toBe("fixture-chunk");
        return route.fulfill({ json: content });
      default:
        return route.fulfill({ status: 404, json: { error_code: "UNEXPECTED_ROUTE" } });
    }
  });

  let attempts = 0;
  await page.route("**/api/v1/qa/answer/stream", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ question });
    const body =
      ++attempts === 1
        ? frame("delta", { text: "未校验的临时正文" }) +
          frame("error", { error_code: "RAG_GENERATION_FAILED", message: "回答生成失败，请重试" })
        : frame("delta", { text: excerpt }) + frame("done", answer);
    await route.fulfill({ contentType: "text/event-stream", body });
  });

  await page.goto("/qa");
  await page.getByLabel("问题").fill(question);
  await page.getByRole("button", { name: "提问", exact: true }).click();
  await expect(page.getByText("RAG_GENERATION_FAILED")).toBeVisible();
  await expect(page.getByText("未校验的临时正文")).toHaveCount(0);

  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByText("fixture-trace", { exact: false })).toBeVisible();
  await expect(page.getByText("RAG_GENERATION_FAILED")).toHaveCount(0);
  await expect(page.getByText("未校验的临时正文")).toHaveCount(0);
  expect(attempts).toBe(2);

  await page.getByRole("button", { name: /第 1 条条文来源/ }).click();
  await expect(page).toHaveURL(/\/documents\/fixture-doc\?[^#]*chunk=fixture-chunk/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.locator("mark")).toHaveText(excerpt);
  await expect(page.getByRole("link", { name: "返回知识库" })).toHaveAttribute(
    "href",
    "/knowledge/default?doc=fixture-doc",
  );
});
