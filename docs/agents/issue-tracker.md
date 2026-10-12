# Issue Tracker：GitHub

本仓库的 Issue 和需求规格记录在 GitHub Issues 中，统一使用 `gh` CLI 操作。

## 基础操作

- 创建：`gh issue create --title "..." --body "..."`
- 查看：`gh issue view <number> --json number,title,body,labels,comments`
- 列表：`gh issue list --state open --json number,title,body,labels,comments`
- 评论：`gh issue comment <number> --body "..."`
- 添加标签：`gh issue edit <number> --add-label "..."`
- 删除标签：`gh issue edit <number> --remove-label "..."`
- 关闭：`gh issue close <number> --comment "..."`
- 建立子任务：`gh issue create --parent <parent> ...` 或 `gh issue edit <parent> --add-sub-issue <child>`

在仓库目录执行命令时，由 `gh` 根据 Git remote 自动确定仓库。

## Pull Request 是否参与 triage

**否。**

Pull Request 不作为需求入口，不与 Issue 共用 triage 状态。若以后需要将外部 PR 纳入 triage，可把本项改为“是”。

GitHub 的 Issue 和 PR 共用编号空间。遇到裸编号 `#42` 时，先执行 `gh pr view 42`，失败后再执行 `gh issue view 42`。

## 技能操作约定

- “发布到 Issue Tracker”：创建 GitHub Issue。
- “读取相关 Ticket”：通过 `gh issue view` 读取对应 Issue。
- 多行正文应通过文件或标准输入传递，避免复杂的 shell 转义。
- 未经用户授权，不创建、修改、评论、标记或关闭 Issue。

## Wayfinding 约定

- Map：使用一个带 `wayfinder:map` 标签的 Issue。
- Child Ticket：优先使用 GitHub Sub-issues 与 Map 关联。
- 类型标签：`wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling`、`wayfinder:task`。
- Blocking：优先使用 GitHub 原生 Issue Dependencies；不可用时，在正文顶部记录 `Blocked by: #<number>`。
- Claim：通过 `gh issue edit <number> --add-assignee @me` 认领。
- Resolve：先留下结论评论，再关闭 Issue，并把必要的上下文链接更新到 Map。
