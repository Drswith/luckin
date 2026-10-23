# Luckin

面向 Codex 的**本地社区插件**，使用[瑞幸 AI 开放平台](https://open.lkcoffee.com/)的官方 MCP 查询门店、商品和订单，提供选购面板、聊天确认卡与取餐状态。**本项目与瑞幸咖啡无关联，也不是瑞幸官方插件。**

源码在 [`plugins/luckin/`](plugins/luckin/)，预构建安装包在 [`release/luckin/`](release/luckin/)。仅支持官方八个工具覆盖的到店取流程：关键词搜索、规格切换、预览、创建、查单与取消；没有完整菜单、专题、账号订单历史、选券、外送、会员、礼品卡、拼单、备注或发票入口。

## 安装与连接

需要 Node.js 22.13 或更新版本、可访问瑞幸 MCP 的网络和用户自己的瑞幸开放平台 Token。安装预构建包不需要 pnpm。

1. 在仓库根目录执行 `codex plugin marketplace add .`，用 `codex plugin list --json --marketplace luckin-community --available` 检查条目，然后在 Codex 桌面版安装并开启插件。
2. 打开 Luckin，点击顶部“连接账号”展开手动连接卡片。自行在[瑞幸 AI 开放平台](https://open.lkcoffee.com/mcp)获取 Token，**只粘贴到插件的密码框并点击“保存并连接”，不要发到对话中**。连接验证后保存在 `~/.config/luckin-community/credentials.json`，目录权限 700、文件权限 600；输入立即清空，不回显。
3. 提供明确经纬度查询门店，执行一次只读查询。未连接时选店和搜索区置灰；401 显示“登录已失效 → 重新登录”。

高级方式：在启动 Codex 的进程环境中配置 `LUCKIN_MCP_TOKEN`，然后重启 Codex。启动时环境变量优先于本插件凭据文件；不要把 Token 写进 Git、清单、聊天、终端历史或共享日志。

本版未启用 `luckin login` 自动登录：官方 CLI 凭据位置、格式及第三方读取许可尚未确认，详见[认证调研](docs/authentication-research.md)。手动连接页面的链接由宿主打开，尚不能保证使用系统默认浏览器。

源码更新后在 `plugins/luckin/` 执行 `pnpm check`，再在仓库根目录运行 `codex plugin add luckin@luckin-community` 更新安装副本并重启 Codex。构建不会自动更新已有插件缓存。

## 点单体验

- **聊天内联**：最多五家门店、八个商品的真实结果轮播；未营业门店置灰。订单预览显示五分钟倒计时，用户点击才提交。取消卡默认“保留订单”，红色描边按钮确认取消，之后自动再次查单。
- **会话侧面板 / 全屏**：同一个应用，宽度 ≥ 960px 显示搜索、规格、购物车三栏，较窄时切换“选商品 / 选规格 / 购物车”。门店条就地展开，提前提示换店会清空购物车并使旧预览失效。规格请求中暂停加购，失败保留旧选项，联动改动明确提示。
- **预览与付款**：优先向对话发送预览请求，宿主不支持时在面板内确认。分别标识商品原价、商品预估价、订单预览金额和待支付金额；订单创建不等于已支付。支付链接仅由官方返回，用户去瑞幸官方渠道付款，不编造支付倒计时。
- **取餐状态**：仅 20/30/60 尝试显示 PiP，45 秒查询一次；10 使用待付款回执，80/100 收起 PiP。字段齐全显示取餐码、预计时间及四段进度；缺字段只显示状态、更新时间与刷新。宿主不支持 PiP 时保留内联状态卡。
- **本地增强**：最近门店及坐标、最近搜索词，以及“本插件订单 · 仅本机记录”。“再来一单”替换购物车并重新预览，不自动下单。记录保存在本插件本地目录，绝不当成瑞幸账号完整历史。

从商品卡打开面板、从内联“换店”打开宿主 modal 都有能力检测与回退。宿主对侧面板位置、PiP、modal 和外部浏览器的支持仍需真实客户端验收，不能仅凭资源注册认定支持。

## 确认与能力边界

| 插件工具 | 官方工具 |
| --- | --- |
| `query_shop_list` | `queryShopList` |
| `search_products` / `product_detail` / `switch_product` | `searchProductForMcp` / `queryProductDetailInfo` / `switchProduct` |
| `review_order` / 界面内 `confirm_order` | `previewOrder` / `createOrder` |
| `order_detail` / `review_cancel` / 界面内 `confirm_cancel` | `queryOrderDetailInfo` / `cancelOrder` |

`open_luckin`、认证、本地记录和购物车版本工具是本地能力，不增加瑞幸接口。`confirm_order`、`confirm_cancel`、`save_token` 都标为 `visibility: ["app"]`，模型不得调用或代替点击。确认凭据在服务端保存五分钟且只能使用一次；换店和修改购物车会作废旧订单预览，网络失败后也不会重放确认。

客户端不渲染确认界面时只能查询、预览。可见性约束由兼容宿主执行，本地 stdio 无法证明调用来自真人，不能当作公开服务的强身份认证。支付始终由用户在官方渠道完成。

## 开发与验证

`pnpm check` 运行模拟测试、构建并重新生成 `release/luckin/`；不要手改安装包。测试不会读取真实 Token，也不调用真实创建或取消接口。当前交付不代表完成真实账号、真实客户端或支付验收。

- [架构与信任边界](docs/architecture.md)
- [官方工具及参数映射](docs/reference.md)
- [认证与宿主能力调研](docs/authentication-research.md)
- [开发和验证](docs/development.md)
- [iPhone App 实机设计调研](docs/native-app-design.md)

公开发布仍需解决公网服务、用户授权、品牌及第三方分发许可；本地 Token 方案不能直接作为公开目录连接器提交。代码使用 [MIT 许可证](plugins/luckin/LICENSE)，瑞幸品牌素材权利归其权利人所有。
