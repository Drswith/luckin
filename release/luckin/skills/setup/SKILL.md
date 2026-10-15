---
name: setup
description: Set up the Luckin community plugin for local Codex use with a user-owned Luckin Coffee AI platform token.
---

# 本地配置

1. 告知用户这是社区项目，与瑞幸咖啡无关联。引导用户自行在 `https://open.lkcoffee.com/mcp` 登录，并创建或查看自己的 MCP Token。
2. 让用户在自己的机器上把 Token 配置为 Codex 进程可读取的 `LUCKIN_MCP_TOKEN` 环境变量。不要要求用户把 Token 发到对话里，也不要写入仓库、插件清单或终端历史。
3. 安装包已预构建，用户无需安装 pnpm 或重新构建。配置环境变量后重启 Codex，再做一次只读的门店或商品查询验证连接。
4. 未取得用户在确认界面的明确操作前，不创建、取消订单或发起付款。

本地 stdio 与固定 Token 方案不能直接满足公开提审要求。当前 Codex 不保证渲染 MCP Apps 确认界面；若界面未出现，只做查询与预览，不创建或取消订单。
