---
name: order-coffee
description: Use Luckin to find a Luckin Coffee store, choose a product, preview an order, or check and cancel an existing order.
---

# 瑞幸点单

仅使用本插件 `luckin` MCP 工具获取实时门店、商品、价格和订单状态。位置、规格、数量和门店不明确时先向用户确认；不要猜测经纬度、商品 ID 或 SKU。

1. 已有用户提供的位置坐标时调用 `query_shop_list`，让用户选定门店。
2. 用 `search_products` 查商品；需要规格时用 `product_detail` 和 `switch_product`，以最新返回的 SKU 为准。
3. 用 `review_order` 获取瑞幸实时预览，并让用户在界面中核对门店、商品、数量和金额。预览不是订单，也不是付款。
4. 只有用户点击确认界面后，界面才调用 `confirm_order`。报告返回的订单 ID 和是否需要付款；付款由用户在瑞幸官方渠道完成，不把预估金额说成已支付金额。
5. 查询订单使用 `order_detail`。需要取消时先用 `review_cancel` 展示订单现状，等待用户在界面确认，再查询一次状态核实结果。

若宿主未渲染 MCP Apps 确认界面，停止创建或取消流程，清楚说明该宿主当前无法完成确认。Token 错误或瑞幸服务异常时提示用户按项目 README 检查本地配置，不索取或复述 Token。
