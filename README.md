# Luckin

面向 Codex 的本地社区插件，使用[瑞幸咖啡 AI 开放平台](https://open.lkcoffee.com/)的官方 MCP 服务查询门店、商品与订单；在支持 OpenAI MCP Extensions 与 MCP Apps 的宿主中提供全局应用、对话侧面板和聊天内联确认卡片。本项目由社区开发，**与瑞幸咖啡无关联，也不是瑞幸官方插件**。

插件包含三层：`skills/` 描述点单工作流；本地 MCP Server 适配瑞幸官方 MCP 工具；MCP Apps 界面提供选店、商品图片、规格、购物车与订单确认。[`release/luckin/`](release/luckin/) 是安装包，[`plugins/luckin/`](plugins/luckin/) 是开发源码；架构及能力边界见 [架构说明](docs/architecture.md)。

## 本地开始使用

需要 Node.js 22.13 或更高版本、可访问瑞幸官方 MCP 的网络，以及用户本人在[瑞幸 AI 开放平台](https://open.lkcoffee.com/mcp)创建的 Token。市场条目安装的是预构建的 `release/luckin/`，安装时不需要 pnpm 或构建；若通过完整仓库获取市场条目，仓库本身仍包含开发源码。

1. 在启动 Codex 的本机进程环境中设置 `LUCKIN_MCP_TOKEN`。Token 仅传给本地适配进程，再由它作为 Bearer 凭据发送给 `https://gwmcp.lkcoffee.com/order/user/mcp`。不要把 Token 写进 Git、`plugin.json`、`mcp.json`、对话或共享日志。瑞幸官网提示该 Token 与账号会话绑定，泄露后应在官网删除。
2. 在仓库根目录执行 `codex plugin marketplace add .`，然后用 `codex plugin list --json --marketplace luckin-community --available` 检查 `Luckin` 条目。在 Codex 桌面版重启并从该本地市场安装、开启插件。先运行只读的门店或商品查询。若环境变量是在 Codex 启动后设置的，需重启 Codex 使插件进程继承新值。

本地开发更新后，运行 `codex plugin add luckin@luckin-community` 刷新安装副本，再重启 Codex。仅重新构建或重启不会自动替换先前复制到插件缓存的文件，详见[开发和验证](docs/development.md)。

支持扩展的宿主会从侧栏的 `Luckin` 入口打开完整选购应用，也可在对话侧面板打开同一应用；订单预览与取消确认仍使用聊天内联卡片。应用按用户填写的坐标查询门店，再按关键词搜索该门店的商品；图片、规格和预估价格来自瑞幸实时返回。当前没有门店完整菜单或订单历史列表接口，因此只支持关键词搜索和按订单号查询。Codex 桌面版已实际显示全局入口；对话侧面板和跨界面确认尚未完成验收；宿主若不支持向对话发送消息，应用会在自身界面展示实时订单预览并保留显式确认。界面入口与信任边界见[架构说明](docs/architecture.md)。当前也尚未使用真实 Token 验证瑞幸查询或订单预览；验证步骤见[开发和验证](docs/development.md)。

## 支持的流程

| 需求 | 插件工具 | 瑞幸官方工具 |
| --- | --- | --- |
| 打开应用，找门店、选商品与规格 | `open_luckin`、`query_shop_list`、`search_products`、`product_detail`、`switch_product` | `queryShopList`、`searchProductForMcp`、`queryProductDetailInfo`、`switchProduct` |
| 预览并创建订单 | `review_order`、界面内 `confirm_order` | `previewOrder`、`createOrder` |
| 查单并取消 | `order_detail`、`review_cancel`、界面内 `confirm_cancel` | `queryOrderDetailInfo`、`cancelOrder` |

`review_order` 和 `review_cancel` 本身不修改订单。确认工具按 MCP Apps 规范标为仅界面可见，预览凭据在本地进程中保存 5 分钟且只能使用一次。创建订单不等于支付；如瑞幸要求付款，用户须在瑞幸官方支付渠道完成。应用侧的可见性由兼容宿主执行；本地 MCP 进程并不能从协议层证明一次工具调用确由真人点击发起，因此不要把这套本地机制当作公开服务的强身份认证。

## 发布边界

当前仓库提供**预构建的本地安装包**，尚未部署公网 MCP 服务、打通面向 ChatGPT/Codex 的 OAuth 2.1 用户授权，也未取得瑞幸对第三方公开连接器分发的授权。OpenAI 的[插件打包说明](https://developers.openai.com/plugins/build/plugins)、[认证规范](https://developers.openai.com/plugins/build/auth)和[提审说明](https://developers.openai.com/plugins/deploy/submission)要求公开提审使用可访问的 HTTPS MCP 服务并完成适当认证；固定 Token 的本地适配方案不能直接作为公开目录版本提交。[插件指南](https://developers.openai.com/plugins/plugin-guidelines)还对第三方服务连接器及品牌使用提出限制。公开发布需要先解决这些实际条件，不能仅上传当前仓库。

## 文档

- [架构与信任边界](docs/architecture.md)：组件、数据流与确认机制。
- [官方能力与实现映射](docs/reference.md)：已核对的入口、工具与参数。
- [开发和验证](docs/development.md)：模拟测试、打包检查及仍需真实验证的环节。
- [iPhone App 实机设计调研](docs/native-app-design.md)：真实界面的场景、视觉规律与开放能力边界。

本项目代码使用 MIT 许可证，见[插件许可证](plugins/luckin/LICENSE)；瑞幸品牌 Logo 的权利归其权利人所有，不随本项目代码许可证授权。
