# 官方能力与实现映射

截至 2026-10-12，从[瑞幸 AI 开放平台](https://open.lkcoffee.com/mcp)当前公开网页及其前端资源核对到生产 MCP 地址 `https://gwmcp.lkcoffee.com/order/user/mcp`，配置方式为 Streamable HTTP + `Authorization: Bearer <Token>`。官方页面展示以下 8 个工具。运行时的真实工具定义、账号授权和返回值仍须由有效 Token 连接后验证。

| 官方工具或入口 | 插件工具 | 关键输入 |
| --- | --- | --- |
| 本地界面入口 | `open_luckin` | 无参数；只打开应用，不访问瑞幸 |
| `queryShopList` | `query_shop_list` | `longitude`, `latitude`, 可选 `deptName` |
| `searchProductForMcp` | `search_products` | `deptId`, `query` |
| `queryProductDetailInfo` | `product_detail` | `deptId`, `productId` |
| `switchProduct` | `switch_product` | `deptId`, `productId`, `skuCode`, `attrOperationParam`, `amount` |
| `previewOrder` | `review_order` | `deptId`, `productList[]` |
| `createOrder` | 界面内 `confirm_order` | 预览时固定的门店、商品、坐标与优惠券 |
| `queryOrderDetailInfo` | `order_detail`、`review_cancel` | `orderId` |
| `cancelOrder` | 界面内 `confirm_cancel` | 经确认的 `orderId` |

`productList[]` 包含 `amount`、`productId`、`skuCode`。`switchProduct.attrOperationParam` 包含属性组 ID、子属性 ID 及操作值；官方页面注明选中操作值为 `3`。官方 `previewOrder` 示例含 `shopInfo`、`productInfoList`、`couponCodeList` 与 `discountPrice`，`createOrder` 示例返回 `orderIdStr`、`needPay` 与支付 URL。插件不把这些示例值当作真实价格或已完成付款。

官方商品搜索返回 `pictureUrl`；订单预览商品项返回 `breviaryPicUrl`、`bigPicUrl`。MCP Apps 商品列表与确认界面优先显示这些来自瑞幸 CDN 的图片；图片缺失或无法加载时显示占位图，不影响名称、规格和价格核对。界面仅允许加载 `luckincoffeecdn.com` 子域名的 HTTPS 商品图片，以及 `web.luckincdn.com` 的官网白色标识。

OpenAI 侧采用[可移植插件清单](https://developers.openai.com/plugins/build/plugins)及[MCP Apps UI resource 与 bridge](https://developers.openai.com/plugins/build/app-quickstart)。本地适配器使用 stdio，不对外提供 HTTPS `/mcp` 服务。

当前资产 `plugins/luckin/assets/luckin-logo.png` 取自瑞幸开放平台官网使用的 [Logo 文件](https://open01.luckincoffeecdn.com/order-mcp-site/assets/luckin-logo-eBRUsw8m.png)（360 × 100，透明 PNG）；聊天内的确认界面使用[瑞幸官网页眉所用的同尺寸完整标识](https://s2.luckincoffeecdn.com/luckyweb/public/assets/82fc225c29de0a222f9dcc6844ecd2d1.png)，避免放大 48 × 48 图标导致模糊；选购全屏界面沿用 Codex 绘制的应用标题栏，不重复展示字标。选购界面空状态使用简洁的选购提示，实际商品图来自瑞幸商品接口。官网页眉 Logo 的主蓝色经原图像素核对为 `#232773`，插件图标、按钮及界面以此为主蓝色。MCP Apps 界面提供亮色与深色方案；深色确认卡片使用[官网白色矢量完整标识](https://web.luckincdn.com/default/assets/logo2-9d412147.svg)，背景和分隔线采用中性深灰，仅在操作处使用瑞幸蓝。深色界面是本社区项目的适配设计，不代表瑞幸官方暗色规范。插件清单要求方形图标。`logo` 和 `composerIcon` 使用 512 × 512 PNG `plugins/luckin/assets/luckin-icon.png`；该图标以[瑞幸国际官网页眉的矢量 Logo](https://web.luckincdn.com/default/assets/logo2-9d412147.svg) 中的鹿头路径制成，矢量母版为 `plugins/luckin/assets/luckin-icon.svg`。MCP Server 初始化元数据另附同源 256 × 256 PNG，供应用入口显示。公开分发前须核实品牌素材使用许可；这些素材不代表瑞幸对社区插件的认可。

选购界面的浅灰与白色分区、较大的杯图和瑞幸蓝操作色参考[瑞幸官网产品页](https://www.lkcoffee.com/products)；[瑞幸官方 App Store 页面](https://apps.apple.com/cn/app/%E7%91%9E%E5%B9%B8%E5%92%96%E5%95%A1/id1296749505)用于核对公开的品牌视觉。新采集的 [iPhone App 实机调研](native-app-design.md)进一步用于商品图文层级、规格联动、购物车及订单状态的设计。桌面三栏、窄侧栏分步面板、组件尺寸和深色适配由本社区项目设计。
