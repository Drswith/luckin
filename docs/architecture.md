# 架构与信任边界

## 组件

```text
Codex 本地插件 / 兼容 MCP Apps 的宿主
  ├─ Luckin Skill（选店、选品、确认流程）
  └─ 本地 stdio MCP Server
       ├─ 只读查询工具
       ├─ 订单预览与短期确认记录
       ├─ OpenAI 扩展入口：全局应用与对话侧面板
       ├─ MCP Apps 商品选购界面与聊天内联确认卡片
       └─ 使用用户 Token 连接瑞幸官方 Streamable HTTP MCP
```

开发源码与构建脚本在 `plugins/luckin/`；预构建安装包在 `release/luckin/`，仓库市场条目 `.agents/plugins/marketplace.json` 指向安装包。包内 `plugin.json` 和 `mcp.json` 定义插件及本地启动命令，`dist/server.mjs` 是运行入口，`ui/shop.html` 与 `ui/app.html` 分别由 MCP resource 返回。安装不运行构建脚本。

## 数据与操作

1. `open_luckin` 是无参数 UI 入口；选购界面通过 MCP Apps bridge 调用查询工具。用户输入经纬度查询门店，再按关键词搜索并读取商品详情；规格变更使用官方 `switchProduct` 返回的新 SKU，购物车保留该 SKU。图片、名称和预估价格来自瑞幸结果。插件不做设备定位或地理编码，也不伪造完整菜单或订单历史。
2. `review_order` 调用官方 `previewOrder`，校验返回的门店坐标，保存完整创建参数，向模型和界面返回可核对摘要及随机 `reviewId`。
3. 用户在 MCP Apps 界面点击确认后，界面调用标记为 `visibility: ["app"]` 的 `confirm_order`。服务端一次性取出对应参数后调用官方 `createOrder`。取消流程同理：先查询订单，再由界面调用 `confirm_cancel`。
4. 确认记录保留在本地进程内存中，五分钟过期。重启进程后自然失效。确认操作发生网络错误时也会消耗记录，避免不确定状态下重复提交；应先查询订单状态。

Token 仅从 `LUCKIN_MCP_TOKEN` 读取，不进入插件清单或 UI。模型可读取预览摘要及 `reviewId`；兼容 MCP Apps 的宿主负责隐藏仅界面可见工具。该标记改善交互边界，但不能代替服务端用户身份认证、支付授权或第三方平台审核。支付始终在瑞幸官方渠道由用户完成。

`open_luckin` 通过 `_meta["openai/ui"].entrypoints` 注册 `global` 与 `thread` 两个入口，使用 `ui/shop.html` 的内容哈希生成资源 URI；该资源声明全屏及内联显示模式。`review_order` 和 `review_cancel` 同样使用 `ui/app.html` 的内容哈希 URI，专门展示聊天内联确认卡片。资源内容变化时 URI 随之变化，避免宿主继续复用旧 HTML。选购界面在宿主支持 `ui/message` 时，将用户点击“预览订单”产生的明确请求发送到当前对话，由模型调用预览工具并显示卡片；不支持时直接调用预览工具，在应用内展示同样的实时摘要与确认操作。[OpenAI 扩展说明](https://developers.openai.com/plugins/build/extensions)记录这些入口与消息能力。用户截图已证实 Codex 桌面版显示全局入口和选购页面；跨界面流转仍需实际回验。

选购界面从商品发现区直接开始，门店选择按钮位于该区域内，不再绘制第二层品牌导航栏。商品列表、详情、购物车分别使用接口图片，购物车显示商品缩略图；缺图时回退占位，空详情显示选购提示。价格区分商品价格、预估到手、订单预览金额和待支付金额。规格更新期间暂停加购，接收完整属性及新 SKU 后回显关联规格变化；旧商品请求不会覆盖新选择。应用内购物车变更会使旧确认预览失效。窄侧栏改为选商品、选规格、购物车三个可切换面板。确认后保留可刷新状态的订单卡，支付时限由官方渠道提供。全局页和确认卡片采用接近 Codex 桌面界面的字号、控件高度与间距，触屏环境保留较大的点击区域。表单由插件 HTML 控制。全屏视图顶部显示应用名称的横栏，以及底部的对话输入区，由宿主绘制；插件只能适配宿主提供的显示模式与主题信号，无法通过自己的 CSS 单独重绘这两个区域。

两份 MCP Apps HTML 使用 `ui/initialize` 返回的 `hostContext.theme` 和后续 `ui/notifications/host-context-changed` 通知切换亮色、深色；兼容旧宿主的 `window.openai.theme`，没有宿主主题信号时跟随系统配色。宿主自身的标题栏及对话输入区仍由 Codex 外观设置决定。

`confirm_order` 和 `confirm_cancel` 仅供界面调用。宿主若不渲染任何 MCP Apps UI，用户仍可使用查询与预览工具，但无法通过当前插件完成创建或取消订单。本地 stdio 安装包也不能直接供云端 ChatGPT 连接。预构建安装和工具注册均不能证明真实宿主界面已经显示或瑞幸实时业务流程已经成功。
