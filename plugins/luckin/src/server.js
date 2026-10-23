import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { AuthError, LuckinUpstream } from "./upstream.js";
import { ReviewStore, orderCreateArgs, orderSummary } from "./reviews.js";
import { catalogSummary } from "./products.js";
import { LocalStore } from "./local.js";
import { orderReceipt, shopSummary } from "./orders.js";

const serverIcon = `data:image/png;base64,${readFileSync(new URL("../assets/luckin-tool-icon.png", import.meta.url)).toString("base64")}`;
const readUi = (name) => readFileSync(new URL(`../ui/${name}`, import.meta.url), "utf8");
const shared = readUi("shared.js");
const shopWidget = readUi("shop.html").replace("/* LUCKIN_SHARED */", () => shared);
const modalWidget = shopWidget.replace('<body>', '<body data-stores-only="true">');
const uiUri = (name, html) => `ui://luckin/${name}-${createHash("sha256").update(html).digest("hex").slice(0, 12)}.html`;
const SHOP_UI_URI = uiUri("shop", shopWidget), MODAL_UI_URI = uiUri("stores", modalWidget);
const reviewWidget = readUi("app.html").replace("/* LUCKIN_SHARED */", () => shared).replaceAll("__LUCKIN_STORES_URI__", MODAL_UI_URI);
const REVIEW_UI_URI = uiUri("app", reviewWidget);
const imageCsp = { resourceDomains: ["https://*.luckincoffeecdn.com", "https://web.luckincdn.com"] };
const positiveId = z.number().int().positive();
const product = z.object({ amount: z.number().int().positive().max(99), productId: positiveId, skuCode: z.string().min(1).max(200) });
const productList = z.array(product).min(1).max(50);
const appOnly = { ui: { resourceUri: REVIEW_UI_URI, visibility: ["app"] } };
const result = (kind, values = {}, message = "查询成功") => ({ content: [{ type: "text", text: message }], structuredContent: { kind, ...values } });

export function createLuckinServer({ upstream, reviews = new ReviewStore(), local = new LocalStore() } = {}) {
  upstream ??= new LuckinUpstream({ token: process.env.LUCKIN_MCP_TOKEN || local.read("credentials", {}).token });
  const server = new McpServer({ name: "luckin", version: "0.2.0", icons: [{ src: serverIcon, mimeType: "image/png", sizes: ["256x256"] }] });
  const shops = new Map();
  let selectedShop = null, cart = null;
  const auth = () => upstream.authStatus();
  const localState = () => ({ ...local.snapshot(), selectedShop, revision: reviews.revision, auth: auth() });
  const invalidate = () => { reviews.invalidateOrders(); cart = null; };
  function safe(handler, retryName) {
    return async (args) => {
      try { return await handler(args); }
      catch (error) {
        const authentication = error instanceof AuthError;
        const message = authentication ? error.message : error instanceof Error ? error.message : "瑞幸请求失败。";
        return { ...result(authentication ? "auth" : "notice", {
          message, ...(authentication ? { expired: error.expired } : {}),
          ...(retryName ? { retry: { name: retryName, args } } : {}),
        }, message), isError: true };
      }
    };
  }
  const register = (name, config, handler, retry = true) => registerAppTool(server, name, {
    ...config, _meta: config._meta || { ui: { resourceUri: REVIEW_UI_URI } },
  }, safe(handler, retry ? name : undefined));
  const remember = (name, value, key, limit) => {
    try { local.remember(name, value, key, limit); return null; }
    catch { return "本次操作已完成，但本机记录未能保存。"; }
  };
  async function getOrder(orderId) {
    const raw = await upstream.call("queryOrderDetailInfo", { orderId });
    const data = orderReceipt(raw, orderId), existing = local.read("orders", []).find((item) => item.orderId === orderId);
    // 查询任意订单不会把它冒充为本插件创建的订单。
    if (existing) {
      data.payOrderUrl ||= existing.payOrderUrl;
      remember("orders", { ...existing, ...data, updatedAt: Date.now() }, "orderId", 50);
    }
    return data;
  }
  async function selectShop(deptId) {
    let shop = shops.get(deptId);
    if (!shop) {
      const saved = local.read("shops", []).find((item) => item.deptId === deptId);
      if (saved && Number.isFinite(saved.longitude) && Number.isFinite(saved.latitude)) {
        const candidates = await upstream.call("queryShopList", { longitude: saved.longitude, latitude: saved.latitude, deptName: saved.deptName });
        for (const item of Array.isArray(candidates) ? candidates : []) shops.set(Number(item.deptId), item);
        shop = shops.get(deptId);
      }
    }
    if (!shop) throw new Error("请先查询门店，再选择取餐门店。");
    shop = shopSummary(shop);
    if (shop.open === false) throw new Error("该门店尚未营业，请选择其他门店。");
    if (selectedShop?.deptId !== deptId) invalidate();
    selectedShop = shop;
    const warning = remember("shops", shop, "deptId", 8);
    return result("selection", { data: shop, revision: reviews.revision, warning }, "已选择门店；更换门店会清空购物车并使旧预览失效。");
  }

  for (const [name, uri, html, modes] of [
    ["luckin-review", REVIEW_UI_URI, reviewWidget, ["inline"]],
    ["luckin-shop", SHOP_UI_URI, shopWidget, ["fullscreen", "inline"]],
    ["luckin-stores", MODAL_UI_URI, modalWidget, ["inline", "fullscreen"]],
  ]) registerAppResource(server, name, uri, {}, async () => ({ contents: [{
    uri, mimeType: RESOURCE_MIME_TYPE, text: html,
    _meta: { ui: { csp: imageCsp }, "openai/ui": { availableDisplayModes: modes, preferredDisplayMode: name === "luckin-shop" ? "fullscreen" : "inline" } },
  }] }));

  register("open_luckin", {
    title: "Luckin", description: "打开同一个瑞幸选购应用，可定位到指定门店商品或展开门店条。",
    inputSchema: { deptId: positiveId.optional(), productId: positiveId.optional(), showShops: z.boolean().optional() },
    annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri: SHOP_UI_URI }, "openai/ui": { entrypoints: [{ type: "global" }, { type: "thread" }] } },
  }, async (args) => result("shop", { ...args, auth: auth() }, "已打开 Luckin。"));

  register("local_state", { title: "读取本机记录", inputSchema: {}, annotations: { readOnlyHint: true }, _meta: appOnly }, async () => result("local", { data: localState() }), false);
  register("save_token", {
    title: "安全保存瑞幸 Token", description: "仅供密码输入框直接提交，禁止模型调用或要求用户在对话中提供 Token。",
    inputSchema: { token: z.string().trim().min(1).max(8192) }, _meta: appOnly,
  }, async ({ token }) => {
    if (/\s/.test(token)) throw new Error("凭据格式不正确，请重新粘贴。");
    try {
      await upstream.setToken(token);
      local.write("credentials", { token });
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new Error("连接或保存失败，请检查网络及本地文件权限。");
    }
    invalidate();
    reviews.pending.clear();
    return result("connected", { data: { connected: true } }, "已连接瑞幸。");
  }, false);

  register("select_shop", { title: "选择取餐门店", inputSchema: { deptId: positiveId }, _meta: appOnly }, async ({ deptId }) => selectShop(deptId), false);
  register("invalidate_previews", { title: "使旧预览失效", inputSchema: { reviewId: z.string().uuid().optional() }, _meta: appOnly }, async ({ reviewId }) => {
    if (reviewId) reviews.discard(reviewId); else invalidate();
    return result("invalidated", { revision: reviews.revision });
  }, false);
  register("review_status", { title: "检查确认有效期", inputSchema: { reviewId: z.string().uuid() }, annotations: { readOnlyHint: true }, _meta: appOnly }, async ({ reviewId }) => result("review-status", { valid: reviews.valid(reviewId) }), false);
  register("prepare_cart", { title: "固定待预览购物车", inputSchema: { deptId: positiveId, productList }, _meta: appOnly }, async (args) => {
    if (selectedShop?.deptId !== args.deptId) throw new Error("门店已变化，请重新选择门店。");
    invalidate();
    cart = args;
    return result("cart", { revision: reviews.revision });
  }, false);

  register("query_shop_list", {
    title: "查询瑞幸门店", description: "按用户提供的坐标查询门店，显示最多五家真实结果。",
    inputSchema: { longitude: z.number().min(-180).max(180), latitude: z.number().min(-90).max(90), deptName: z.string().optional() }, annotations: { readOnlyHint: true },
  }, async (args) => {
    const data = await upstream.call("queryShopList", args);
    const list = (Array.isArray(data) ? data : []).filter((item) => Number.isSafeInteger(Number(item.deptId)) && Number(item.deptId) > 0);
    for (const shop of list) shops.set(Number(shop.deptId), shop);
    return result("shops", { data: list.map((shop) => shopSummary(shop)), query: args });
  });
  register("search_products", {
    title: "搜索瑞幸商品", description: "在指定门店按关键词搜索商品；不提供完整菜单。",
    inputSchema: { deptId: positiveId, query: z.string().min(1).max(200) }, annotations: { readOnlyHint: true },
  }, async (args) => {
    const data = await upstream.call("searchProductForMcp", args);
    remember("searches", { query: args.query }, "query", 8);
    return result("catalog", { data, deptId: args.deptId, products: catalogSummary(data) });
  });
  register("product_detail", {
    title: "查询商品详情", inputSchema: { deptId: positiveId, productId: positiveId }, annotations: { readOnlyHint: true },
  }, async (args) => result("product", { deptId: args.deptId, data: await upstream.call("queryProductDetailInfo", args) }));
  register("switch_product", {
    title: "切换商品规格", description: "用官方属性 ID 切换规格，选中操作值为 3。",
    inputSchema: { deptId: positiveId, productId: positiveId, skuCode: z.string().min(1), attrOperationParam: z.object({ attributeId: positiveId, subAttr: z.object({ attributeId: positiveId, operation: z.literal(3) }) }), amount: z.number().int().positive().max(99) }, annotations: { readOnlyHint: true },
  }, async (args) => result("product", { deptId: args.deptId, data: await upstream.call("switchProduct", args) }));
  register("order_detail", { title: "查询瑞幸订单", inputSchema: { orderId: z.string().min(1) }, annotations: { readOnlyHint: true } }, async ({ orderId }) => result("receipt", { data: await getOrder(orderId) }));

  register("review_order", {
    title: "预览待确认订单", description: "实时预览，尚未创建或支付。若从购物车发起，必须原样传入 cartRevision；只能由用户在界面确认。",
    inputSchema: { deptId: positiveId, productList, cartRevision: z.number().int().nonnegative().optional() }, annotations: { readOnlyHint: true },
  }, async ({ cartRevision, ...args }) => {
    const revision = reviews.revision;
    if (cartRevision !== undefined && (cartRevision !== revision || JSON.stringify(cart) !== JSON.stringify(args))) throw new Error("购物车或门店已变化，请重新预览。");
    if (selectedShop && selectedShop.deptId !== args.deptId) throw new Error("门店已变化，请重新选择门店后预览。");
    const preview = await upstream.call("previewOrder", args);
    if (reviews.revision !== revision) throw new Error("购物车或门店已变化，请重新预览。");
    const createArgs = orderCreateArgs(args, preview), summary = orderSummary(preview);
    shops.set(args.deptId, preview.shopInfo);
    const reviewId = reviews.create("order", { createArgs, summary });
    return result("order", { reviewId, summary, input: { ...args, ...(cartRevision !== undefined ? { cartRevision } : {}) }, expiresAt: reviews.expiresAt(reviewId), expiresInSeconds: 300 }, `订单预览金额 ¥${summary.total.toFixed(2)}。请在确认界面核对；尚未创建订单或付款。客户端不支持确认界面时不能提交。`);
  });
  register("confirm_order", {
    title: "用户确认创建订单", description: "仅供界面在用户点击后调用，不自动付款。", inputSchema: { reviewId: z.string().uuid() }, annotations: { destructiveHint: true }, _meta: appOnly,
  }, async ({ reviewId }) => {
    const { createArgs, summary } = reviews.take("order", reviewId);
    const raw = await upstream.call("createOrder", createArgs), data = orderReceipt(raw);
    data.shopInfo ||= { deptId: createArgs.deptId, deptName: summary.shop.name, address: summary.shop.address };
    remember("shops", { ...shops.get(createArgs.deptId), deptId: createArgs.deptId, longitude: createArgs.longitude, latitude: createArgs.latitude }, "deptId", 8);
    if (data.orderId) data.warning = remember("orders", { ...data, products: summary.products, input: { deptId: createArgs.deptId, productList: createArgs.productList }, createdAt: Date.now() }, "orderId", 50);
    return result("receipt", { data }, "订单已创建。如需付款，请前往瑞幸官方渠道；尚不能据此认定已支付。");
  }, false);
  register("review_cancel", {
    title: "预览取消订单", description: "查询现状并显示确认卡，不取消订单。", inputSchema: { orderId: z.string().min(1) }, annotations: { readOnlyHint: true },
  }, async ({ orderId }) => {
    const order = await getOrder(orderId);
    if ([80, 100].includes(order.orderStatus)) throw new Error("订单已结束，无需取消。");
    const reviewId = reviews.create("cancel", { orderId });
    return result("cancel", { reviewId, summary: { orderId, status: order.orderStatusName, shop: order.shopInfo?.deptName ?? "" }, input: { orderId }, expiresAt: reviews.expiresAt(reviewId), expiresInSeconds: 300 }, "请在界面决定是否取消；默认保留订单。客户端不支持确认界面时不能提交。");
  });
  register("confirm_cancel", {
    title: "用户确认取消订单", description: "仅供用户点击确认取消后调用；提交后自动查一次最终状态。", inputSchema: { reviewId: z.string().uuid() }, annotations: { destructiveHint: true }, _meta: appOnly,
  }, async ({ reviewId }) => {
    const { orderId } = reviews.take("cancel", reviewId);
    const cancelled = await upstream.call("cancelOrder", { orderId });
    if (cancelled !== true && cancelled?.data !== true) throw new Error("瑞幸未确认取消成功，请刷新订单状态。");
    try { return result("receipt", { data: { ...await getOrder(orderId), cancelled: true } }, "取消请求已提交，已重新查询订单状态。"); }
    catch { return result("receipt", { data: { orderId, cancelled: true, warning: "取消请求已提交，但状态刷新失败，请刷新核实。" } }, "取消请求已提交，最终状态待核实。"); }
  }, false);
  register("reorder", { title: "带入本机订单商品", description: "只返回原商品和规格用于重新预览，不创建订单。", inputSchema: { orderId: z.string().min(1) }, annotations: { readOnlyHint: true }, _meta: appOnly }, async ({ orderId }) => {
    const order = local.read("orders", []).find((item) => item.orderId === orderId);
    if (!order?.input) throw new Error("没有此订单的本机商品记录。");
    return result("reorder", { data: { input: order.input, products: order.products } });
  }, false);
  return server;
}
