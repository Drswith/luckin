# 开发和验证

## 本地检查

在 `plugins/luckin/` 执行：

```bash
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` 用内存 MCP 传输与模拟瑞幸上游验证工具注册、商品图片映射、预览、一次性确认、超时及取消链路，然后构建单文件 MCP Server，并按明确的文件清单生成 `release/luckin/`。测试不会读取真实 Token，也不会创建真实订单。开发者提交源码、锁文件和更新后的预构建安装包；安装者无需 pnpm 或构建工具。

本地市场把 `release/luckin/` 复制到 Codex 的插件缓存。更新发布包后，在仓库根目录运行 `codex plugin add luckin@luckin-community` 重新安装，再重启 Codex Desktop 并重新打开 Luckin。仅重启不会保证已有安装副本更新；可对比 `release/luckin/ui/shop.html` 与 `~/.codex/plugins/cache/luckin-community/luckin/<版本>/ui/shop.html` 核实。不要直接修改缓存目录。

发布目录只包含 `plugin.json`、`mcp.json`、许可证、技能、品牌资源、`dist/server.mjs`、`ui/shop.html` 和 `ui/app.html`。仓库市场指向此目录；`src/`、`test/`、`node_modules/` 与构建工具不会复制到安装副本。单独运行 `pnpm run package` 可重新生成安装包。单文件 JavaScript 仍可被阅读，不是保护代码或凭据的手段。

这里保留 esbuild：目前只需要把一个 Node.js MCP 入口打成可随插件复制的单文件，两份界面仍是自包含 HTML，没有需要 Vite 处理的模块、资源或开发服务器。Vite 可给分离的 JS/CSS 文件加哈希，但 MCP Apps 宿主读取的是注册的 HTML 资源 URI；服务端直接按 HTML 内容哈希生成这个 URI，处理旧界面复用问题。若后续界面拆成多文件应用，再评估 Vite；若转为 TypeScript 并需要声明文件或库构建约定，再评估 tsdown。

回到仓库根目录执行 `git diff --check`，并检查 `git status --short`，确认没有 Token、真实订单或日志进入版本库。文档改动还要检查 README、AGENTS、文档间相对链接与市场清单路径。

## 实机调研后的 UI 验证

0.1.8 依据 [iPhone App 实机记录](native-app-design.md)调整商品、规格、购物车和订单卡片。独立浏览器中的模拟宿主验证覆盖 1280px 桌面亮色/暗色、390px 窄侧栏及 430px 内联卡片；这些尺寸未出现横向溢出，商品图正常加载，已执行流程中未捕获页面异常或控制台错误。

交互检查包括：选店与搜索、规格联动、更新期间禁用加购、失败时保留原选择、切换门店清空购物车、修改购物车后使应用内旧预览失效、支持 `ui/message` 时发送到对话、不支持时显示应用内确认、连续确认只提交一次、待付款与金额展示、订单状态刷新。浏览器测试使用模拟门店、规格、金额和订单，不连接真实账号；真实 App 截图只作为设计依据，未作为页面数据或测试素材提交。

## 真实验收边界

有用户自有 Token 时，依次验证本地市场安装、Codex 启动 MCP 与列出工具、全局与对话侧面板是否出现、瑞幸实时门店和商品查询、规格切换、订单预览与内联确认卡片。前几项通过不能证明后面的界面或业务流程可用；用户截图已证实 Codex 全局入口和选购页面可见，新版亮色与深色界面已在独立浏览器中检查，尚未在 Codex 宿主中回验，也未完成真实 Token 查询及跨界面流程验收。[架构说明](architecture.md)记录界面入口及宿主支持边界。

创建或取消真实订单会修改用户账户，只能在用户明确授权的具体场景下验证，并分别记录测试账号、下单或取消结果。创建订单不代表完成支付；如需付款，仍由用户在瑞幸官方渠道完成。

公开目录版本还需要独立的公网服务、用户认证、品牌与第三方分发授权，并重新按 OpenAI 当前提审要求测试。此仓库当前没有部署或提审记录。
