import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { LuckinUpstream } from "./upstream.js";
import { ReviewStore, orderCreateArgs, orderSummary } from "./reviews.js";
import { catalogSummary } from "./products.js";

const serverIcon = `data:image/png;base64,${readFileSync(new URL("../assets/luckin-tool-icon.png", import.meta.url)).toString("base64")}`;
const reviewWidget = readFileSync(new URL("../ui/app.html", import.meta.url), "utf8");
const shopWidget = readFileSync(new URL("../ui/shop.html", import.meta.url), "utf8");
const uiUri = (name, html) => `ui://luckin/${name}-${createHash("sha256").update(html).digest("hex").slice(0, 12)}.html`;
const REVIEW_UI_URI = uiUri("app", reviewWidget);
const SHOP_UI_URI = uiUri("shop", shopWidget);
const imageCsp = { resourceDomains: ["https://*.luckincoffeecdn.com", "https://web.luckincdn.com"] };
const positiveId = z.number().int().positive();
const productList = z.array(z.object({
  amount: z.number().int().positive(),
  productId: positiveId,
  skuCode: z.string().min(1),
})).min(1);

function dataResult(data, message = "查询成功") {
  return { content: [{ type: "text", text: message }], structuredContent: { data } };
}

function errorResult(error) {
  return {
    isError: true,
    content: [{ type: "text", text: error instanceof Error ? error.message : "瑞幸服务请求失败。" }],
  };
}

function safe(handler) {
  return async (args) => {
    try {
      return await handler(args);
    } catch (error) {
      return errorResult(error);
    }
  };
}

export function createLuckinServer({ upstream = new LuckinUpstream(), reviews = new ReviewStore() } = {}) {
  const server = new McpServer({
    name: "luckin",
    version: "0.1.7",
    icons: [{ src: serverIcon, mimeType: "image/png", sizes: ["256x256"] }],
  });

  registerAppResource(server, "luckin-review", REVIEW_UI_URI, {}, async () => ({
    contents: [{
      uri: REVIEW_UI_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: reviewWidget,
      _meta: { ui: { csp: imageCsp }, "openai/ui": { availableDisplayModes: ["inline"] } },
    }],
  }));

  registerAppResource(server, "luckin-shop", SHOP_UI_URI, {}, async () => ({
    contents: [{
      uri: SHOP_UI_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: shopWidget,
      _meta: { ui: { csp: imageCsp }, "openai/ui": { availableDisplayModes: ["fullscreen", "inline"] } },
    }],
  }));

  registerAppTool(server, "open_luckin", {
    title: "Luckin",
    description: "打开 Luckin 商品搜索和购物车应用。",
    inputSchema: {},
    annotations: { readOnlyHint: true },
    _meta: {
      ui: { resourceUri: SHOP_UI_URI, visibility: ["app"] },
      "openai/ui": { entrypoints: [{ type: "global" }, { type: "thread" }] },
    },
  }, async () => ({ content: [{ type: "text", text: "已打开 Luckin。" }], structuredContent: { kind: "shop" } }));

  server.registerTool("query_shop_list", {
    title: "查询瑞幸门店",
    description: "按位置和可选门店名称查询瑞幸门店。经纬度来自用户明确提供的位置。",
    inputSchema: {
      longitude: z.number().min(-180).max(180),
      latitude: z.number().min(-90).max(90),
      deptName: z.string().optional(),
    },
    annotations: { readOnlyHint: true },
  }, safe(async (args) => dataResult(await upstream.call("queryShopList", args))));

  server.registerTool("search_products", {
    title: "搜索瑞幸商品",
    description: "在指定门店按用户原始描述搜索商品与可选规格。",
    inputSchema: { deptId: positiveId, query: z.string().min(1) },
    annotations: { readOnlyHint: true },
  }, safe(async (args) => {
    const data = await upstream.call("searchProductForMcp", args);
    return {
      content: [{ type: "text", text: "已找到瑞幸商品。请根据商品 ID 和规格继续选择。" }],
      structuredContent: { kind: "catalog", data, products: catalogSummary(data) },
    };
  }));

  server.registerTool("product_detail", {
    title: "查询商品详情",
    description: "读取指定门店商品的详情和规格。",
    inputSchema: { deptId: positiveId, productId: positiveId },
    annotations: { readOnlyHint: true },
  }, safe(async (args) => dataResult(await upstream.call("queryProductDetailInfo", args))));

  server.registerTool("switch_product", {
    title: "切换商品规格",
    description: "根据瑞幸返回的属性 ID 选择商品规格，得到更新后的 SKU。operation 选中值为 3。",
    inputSchema: {
      deptId: positiveId,
      productId: positiveId,
      skuCode: z.string().min(1),
      attrOperationParam: z.object({
        attributeId: positiveId,
        subAttr: z.object({ attributeId: positiveId, operation: z.literal(3) }),
      }),
      amount: z.number().int().positive(),
    },
    annotations: { readOnlyHint: true },
  }, safe(async (args) => dataResult(await upstream.call("switchProduct", args))));

  server.registerTool("order_detail", {
    title: "查询瑞幸订单",
    description: "按订单 ID 查询当前订单状态与取餐信息。",
    inputSchema: { orderId: z.string().min(1) },
    annotations: { readOnlyHint: true },
  }, safe(async (args) => dataResult(await upstream.call("queryOrderDetailInfo", args))));

  registerAppTool(server, "review_order", {
    title: "预览待确认订单",
    description: "从瑞幸获取实时门店、商品和金额预览，并显示给用户确认。此工具不创建订单。",
    inputSchema: { deptId: positiveId, productList },
    annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri: REVIEW_UI_URI } },
  }, safe(async (args) => {
    const preview = await upstream.call("previewOrder", args);
    const createArgs = orderCreateArgs(args, preview);
    const summary = orderSummary(preview);
    const reviewId = reviews.create("order", createArgs);
    return {
      content: [{ type: "text", text: `请用户核对门店、商品和价格后，在确认界面创建订单。当前预估金额 ¥${summary.total.toFixed(2)}；尚未创建订单或付款。` }],
      structuredContent: { kind: "order", reviewId, summary, expiresInSeconds: 300 },
    };
  }));

  registerAppTool(server, "confirm_order", {
    title: "用户确认创建订单",
    description: "仅供瑞幸确认界面在用户点击后调用；创建订单，不自动付款。",
    inputSchema: { reviewId: z.string().uuid() },
    annotations: { destructiveHint: true },
    _meta: { ui: { resourceUri: REVIEW_UI_URI, visibility: ["app"] } },
  }, safe(async ({ reviewId }) => {
    const args = reviews.take("order", reviewId);
    const data = await upstream.call("createOrder", args);
    return dataResult({
      orderId: String(data.orderIdStr ?? data.orderId ?? ""),
      needPay: Boolean(data.needPay),
      total: Number(data.discountPrice ?? 0),
      payOrderUrl: typeof data.payOrderUrl === "string" ? data.payOrderUrl : null,
    }, "订单已创建。若需支付，请在瑞幸提供的官方支付渠道完成；本插件不会自动付款。");
  }));

  registerAppTool(server, "review_cancel", {
    title: "预览取消订单",
    description: "查询订单当前状态，并显示取消确认界面。此工具不取消订单。",
    inputSchema: { orderId: z.string().min(1) },
    annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri: REVIEW_UI_URI } },
  }, safe(async ({ orderId }) => {
    const order = await upstream.call("queryOrderDetailInfo", { orderId });
    if (order.orderStatus === 100) throw new Error("此订单已经取消。");
    const reviewId = reviews.create("cancel", { orderId });
    return {
      content: [{ type: "text", text: `请用户在确认界面核对并决定是否取消订单 ${orderId}；尚未取消。` }],
      structuredContent: {
        kind: "cancel",
        reviewId,
        summary: {
          orderId,
          status: String(order.orderStatusName ?? order.orderStatus ?? "未知"),
          shop: String(order.shopInfo?.deptName ?? ""),
        },
        expiresInSeconds: 300,
      },
    };
  }));

  registerAppTool(server, "confirm_cancel", {
    title: "用户确认取消订单",
    description: "仅供瑞幸确认界面在用户点击后调用；取消订单。",
    inputSchema: { reviewId: z.string().uuid() },
    annotations: { destructiveHint: true },
    _meta: { ui: { resourceUri: REVIEW_UI_URI, visibility: ["app"] } },
  }, safe(async ({ reviewId }) => {
    const { orderId } = reviews.take("cancel", reviewId);
    const cancelled = await upstream.call("cancelOrder", { orderId });
    const success = cancelled === true || cancelled?.data === true;
    if (!success) throw new Error("瑞幸未确认订单取消成功。请查询订单状态后再处理。");
    return dataResult({ orderId, cancelled: true }, "已向瑞幸提交取消请求。请查询订单状态确认最终结果。");
  }));

  return server;
}
