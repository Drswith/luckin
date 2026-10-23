import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStore } from "../src/local.js";
import { pickupState, paymentUrl, shopSummary } from "../src/orders.js";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createLuckinServer } from "../src/server.js";
import { ReviewStore } from "../src/reviews.js";
import { catalogSummary, officialProductImage } from "../src/products.js";
import { AuthError, OFFICIAL_TOOLS, LuckinUpstream, unwrapOfficialResult } from "../src/upstream.js";

async function harness({ responses, now = { value: 1000 }, connected = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "luckin-test-")), local = new LocalStore({ directory });
  const calls = [];
  const upstream = {
    authStatus: () => ({ connected, expired: false }),
    async setToken() { connected = true; },
    async call(name, args) {
      calls.push({ name, args });
      const response = responses?.[name];
      if (response === undefined) throw new Error(`Unexpected upstream call: ${name}`);
      return typeof response === "function" ? response(args) : response;
    },
  };
  const server = createLuckinServer({ upstream, local, reviews: new ReviewStore({ now: () => now.value }) });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, calls, local, directory, close: async () => { await client.close(); await server.close(); rmSync(directory, { recursive: true, force: true }); } };
}

const preview = {
  discountPrice: 16,
  shopInfo: { deptId: 12, deptName: "测试门店", address: "测试地址", longitude: 116.39, latitude: 39.98 },
  productInfoList: [{ productId: 34, skuCode: "SKU-1", name: "冰美式", amount: 1, additionDesc: "少冰", estimateTotalPrice: 16, breviaryPicUrl: "https://imgtest03.luckincoffeecdn.com/coffee.jpg" }],
  couponCodeList: ["C1"],
};
const orderInput = { deptId: 12, productList: [{ amount: 1, productId: 34, skuCode: "SKU-1" }] };

test("商品摘要只保留官方图片与原价语义", () => {
  assert.equal(officialProductImage("https://imgtest03.luckincoffeecdn.com/coffee.jpg"), "https://imgtest03.luckincoffeecdn.com/coffee.jpg");
  assert.equal(officialProductImage("https://luckincoffeecdn.com.evil.example/coffee.jpg"), null);
  assert.equal(officialProductImage("http://imgtest03.luckincoffeecdn.com/coffee.jpg"), null);
  assert.deepEqual(catalogSummary([{ productId: 34, productName: "冰美式", pictureUrl: "https://imgtest03.luckincoffeecdn.com/coffee.jpg", estimatePrice: 16 }]), [{
    productId: 34, name: "冰美式", imageUrl: "https://imgtest03.luckincoffeecdn.com/coffee.jpg", price: null, estimatePrice: 16, tags: "",
  }]);
});

test("全局与会话入口注册同一应用并返回商品图片", async () => {
  const h = await harness({ now: { value: 1000 }, responses: {
    searchProductForMcp: [{ productId: 34, productName: "冰美式", skuCode: "SKU-1", pictureUrl: "https://imgtest03.luckincoffeecdn.com/coffee.jpg", estimatePrice: 16 }],
  } });
  try {
    const icon = h.client.getServerVersion().icons?.[0];
    assert.equal(icon?.mimeType, "image/png");
    assert.deepEqual(icon?.sizes, ["256x256"]);
    assert.deepEqual(
      Buffer.from(icon.src.slice("data:image/png;base64,".length), "base64"),
      readFileSync(new URL("../assets/luckin-tool-icon.png", import.meta.url)),
    );
    const listed = await h.client.listTools();
    const entry = listed.tools.find((tool) => tool.name === "open_luckin");
    assert.equal(entry.title, "Luckin");
    assert.match(entry._meta.ui.resourceUri, /^ui:\/\/luckin\/shop-[0-9a-f]{12}\.html$/);
    assert.deepEqual(entry._meta["openai/ui"].entrypoints, [{ type: "global" }, { type: "thread" }]);
    assert.deepEqual((await h.client.callTool({ name: "open_luckin", arguments: {} })).structuredContent, { kind: "shop", auth: { connected: true, expired: false } });
    const result = await h.client.callTool({ name: "search_products", arguments: { deptId: 12, query: "冰美式" } });
    assert.equal(result.structuredContent.products[0].imageUrl, "https://imgtest03.luckincoffeecdn.com/coffee.jpg");
    assert.equal(result.structuredContent.data[0].skuCode, "SKU-1");
    const resource = await h.client.readResource({ uri: entry._meta.ui.resourceUri });
    const contentHash = createHash("sha256").update(resource.contents[0].text).digest("hex").slice(0, 12);
    assert.equal(entry._meta.ui.resourceUri, `ui://luckin/shop-${contentHash}.html`);
    assert.deepEqual(resource.contents[0]._meta.ui.csp.resourceDomains, ["https://*.luckincoffeecdn.com", "https://web.luckincdn.com"]);
    assert.deepEqual(resource.contents[0]._meta["openai/ui"].availableDisplayModes, ["fullscreen", "inline"]);
    assert.match(resource.contents[0].text, /预览订单/);
    assert.match(resource.contents[0].text, /luckincoffeecdn\.com/);
  } finally { await h.close(); }
});

test("上游响应解析识别认证错误", () => {
  assert.deepEqual(unwrapOfficialResult({ content: [{ type: "text", text: JSON.stringify({ code: 0, success: true, data: [1] }) }] }), [1]);
  assert.throws(() => unwrapOfficialResult({ structuredContent: { code: 401, success: false, msg: "expired" } }), /登录已失效/);
});

test("HTTP 适配器仅向上游传递凭据并调用官方工具", async () => {
  const authHeaders = [];
  const http = createServer(async (req, res) => {
    authHeaders.push(req.headers.authorization);
    const server = new McpServer({ name: "fake-luckin", version: "1" });
    server.registerTool("queryShopList", { inputSchema: {} }, async () => ({
      content: [{ type: "text", text: JSON.stringify({ code: 0, success: true, data: [{ deptId: 12 }] }) }],
    }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      if (!res.headersSent) res.writeHead(500).end(String(error));
    }
  });
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  const upstream = new LuckinUpstream({ token: "test-token", url: `http://127.0.0.1:${http.address().port}/mcp` });
  try {
    const data = await upstream.call("queryShopList", { longitude: 116.39, latitude: 39.98 });
    assert.deepEqual(data, [{ deptId: 12 }]);
    assert.ok(authHeaders.length >= 2);
    assert.ok(authHeaders.every((value) => value === "Bearer test-token"));
  } finally {
    await upstream.close();
    await new Promise((resolve) => http.close(resolve));
  }
});

test("实时预览与界面确认至多创建一次订单", async () => {
  const now = { value: 1000 };
  const h = await harness({ now, responses: {
    previewOrder: preview,
    createOrder: { orderIdStr: "7639308439653908490", needPay: true, discountPrice: 16 },
  } });
  try {
    const listed = await h.client.listTools();
    assert.equal(listed.tools.find((tool) => tool.name === "confirm_order")._meta.ui.visibility[0], "app");
    const reviewed = await h.client.callTool({ name: "review_order", arguments: orderInput });
    assert.equal(reviewed.structuredContent.summary.total, 16);
    assert.equal(reviewed.structuredContent.summary.products[0].imageUrl, "https://imgtest03.luckincoffeecdn.com/coffee.jpg");
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].name, "previewOrder");
    const reviewId = reviewed.structuredContent.reviewId;
    const created = await h.client.callTool({ name: "confirm_order", arguments: { reviewId } });
    assert.equal(created.structuredContent.data.orderId, "7639308439653908490");
    assert.deepEqual(h.calls[1], {
      name: "createOrder",
      args: { ...orderInput, longitude: 116.39, latitude: 39.98, couponCodeList: ["C1"] },
    });
    const replay = await h.client.callTool({ name: "confirm_order", arguments: { reviewId } });
    assert.equal(replay.isError, true);
    assert.equal(h.calls.length, 2);
    const resource = await h.client.readResource({ uri: (await h.client.listTools()).tools.find((tool) => tool.name === "review_order")._meta.ui.resourceUri });
    assert.match(resource.contents[0].text, /ui\/initialize/);
    assert.match(resource.contents[0].text, /availableDisplayModes: \["inline", "fullscreen", "pip"\]/);
    assert.deepEqual(resource.contents[0]._meta["openai/ui"].availableDisplayModes, ["inline"]);
  } finally { await h.close(); }
});

test("过期预览不能创建订单", async () => {
  const now = { value: 1000 };
  const h = await harness({ now, responses: { previewOrder: preview } });
  try {
    const reviewed = await h.client.callTool({ name: "review_order", arguments: orderInput });
    now.value += 300001;
    const result = await h.client.callTool({ name: "confirm_order", arguments: { reviewId: reviewed.structuredContent.reviewId } });
    assert.equal(result.isError, true);
    assert.deepEqual(h.calls.map((call) => call.name), ["previewOrder"]);
  } finally { await h.close(); }
});

test("预览缺少有效金额时不能确认", async () => {
  const h = await harness({ now: { value: 1000 }, responses: { previewOrder: { ...preview, discountPrice: undefined } } });
  try {
    const result = await h.client.callTool({ name: "review_order", arguments: orderInput });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /有效订单预览金额/);
    assert.deepEqual(h.calls.map((call) => call.name), ["previewOrder"]);
  } finally { await h.close(); }
});

test("取消必须预览与界面确认且自动查单", async () => {
  const now = { value: 1000 };
  const h = await harness({ now, responses: {
    queryOrderDetailInfo: { orderStatus: 30, orderStatusName: "制作中", shopInfo: { deptName: "测试门店" } },
    cancelOrder: true,
  } });
  try {
    const reviewed = await h.client.callTool({ name: "review_cancel", arguments: { orderId: "123" } });
    assert.equal(reviewed.structuredContent.summary.status, "制作中");
    assert.deepEqual(h.calls.map((call) => call.name), ["queryOrderDetailInfo"]);
    const result = await h.client.callTool({ name: "confirm_cancel", arguments: { reviewId: reviewed.structuredContent.reviewId } });
    assert.equal(result.structuredContent.data.cancelled, true);
    assert.deepEqual(h.calls[1], { name: "cancelOrder", args: { orderId: "123" } });
    assert.deepEqual(h.calls[2], { name: "queryOrderDetailInfo", args: { orderId: "123" } });
  } finally { await h.close(); }
});

test("官方返回取消失败时不报告成功", async () => {
  const now = { value: 1000 };
  const h = await harness({ now, responses: {
    queryOrderDetailInfo: { orderStatus: 30, orderStatusName: "制作中" },
    cancelOrder: false,
  } });
  try {
    const reviewed = await h.client.callTool({ name: "review_cancel", arguments: { orderId: "123" } });
    const result = await h.client.callTool({ name: "confirm_cancel", arguments: { reviewId: reviewed.structuredContent.reviewId } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /未确认/);
  } finally { await h.close(); }
});

test("创建订单缺少金额时保持未知而非零元", async () => {
  const h = await harness({ now: { value: 1000 }, responses: {
    previewOrder: preview,
    createOrder: { orderIdStr: "mock-order", needPay: true },
  } });
  try {
    const reviewed = await h.client.callTool({ name: "review_order", arguments: orderInput });
    const created = await h.client.callTool({ name: "confirm_order", arguments: { reviewId: reviewed.structuredContent.reviewId } });
    assert.equal(created.structuredContent.data.total, null);
    assert.equal(created.structuredContent.data.needPay, true);
  } finally { await h.close(); }
});

const invoke = (h, name, args = {}) => h.client.callTool({ name, arguments: args });
test("确认、取消及凭据保存工具只对界面可见", async () => {
  const h = await harness();
  try {
    const { tools } = await h.client.listTools();
    for (const name of ["confirm_order", "confirm_cancel", "save_token"]) assert.deepEqual(tools.find((tool) => tool.name === name)._meta.ui.visibility, ["app"]);
    assert.equal(tools.some((tool) => OFFICIAL_TOOLS.includes(tool.name)), false);
  } finally { await h.close(); }
});
test("五分钟边界失效且并发确认只有一个上游请求", async () => {
  const now = { value: 1000 }, h = await harness({ now, responses: { previewOrder: preview, createOrder: { orderIdStr: "mock-concurrent", needPay: true } } });
  try {
    const first = (await invoke(h, "review_order", orderInput)).structuredContent;
    assert.equal(first.expiresAt, 301000); now.value = 301000;
    assert.equal((await invoke(h, "confirm_order", { reviewId: first.reviewId })).isError, true);
    const second = (await invoke(h, "review_order", orderInput)).structuredContent;
    const results = await Promise.all([invoke(h, "confirm_order", { reviewId: second.reviewId }), invoke(h, "confirm_order", { reviewId: second.reviewId })]);
    assert.equal(results.filter((item) => !item.isError).length, 1);
    assert.equal(h.calls.filter((item) => item.name === "createOrder").length, 1);
  } finally { await h.close(); }
});
test("401 返回认证卡且不自动重试创建订单", async () => {
  const h = await harness({ responses: { queryShopList: () => { throw new AuthError(); }, previewOrder: preview, createOrder: () => { throw new AuthError(); } } });
  try {
    const query = await invoke(h, "query_shop_list", { longitude: 120, latitude: 30 });
    assert.equal(query.structuredContent.kind, "auth"); assert.equal(query.structuredContent.expired, true);
    assert.equal(query.structuredContent.retry.name, "query_shop_list"); assert.match(query.content[0].text, /登录已失效/);
    const review = (await invoke(h, "review_order", orderInput)).structuredContent;
    const confirmed = (await invoke(h, "confirm_order", { reviewId: review.reviewId })).structuredContent;
    assert.equal(confirmed.kind, "auth"); assert.equal(confirmed.retry, undefined);
  } finally { await h.close(); }
});
test("手动凭据保存为 600 文件且不进入结果或本机记录", async () => {
  const h = await harness({ connected: false }), token = "synthetic-secret-never-display";
  try {
    const output = await invoke(h, "save_token", { token });
    assert.equal(output.isError, undefined); assert.equal(JSON.stringify(output).includes(token), false);
    assert.equal(h.local.read("credentials", {}).token, token);
    assert.equal(statSync(join(h.directory, "credentials.json")).mode & 0o777, 0o600);
    assert.equal(statSync(h.directory).mode & 0o777, 0o700);
    assert.equal(JSON.stringify(await invoke(h, "local_state")).includes(token), false);
  } finally { await h.close(); }
});
test("切换门店使聊天旧预览和延迟购物车请求失效", async () => {
  const h = await harness({ responses: { queryShopList: [preview.shopInfo, { ...preview.shopInfo, deptId: 13 }], previewOrder: preview } });
  try {
    await invoke(h, "query_shop_list", { longitude: 120, latitude: 30 }); await invoke(h, "select_shop", { deptId: 12 });
    const { revision } = (await invoke(h, "prepare_cart", orderInput)).structuredContent;
    const { reviewId } = (await invoke(h, "review_order", { ...orderInput, cartRevision: revision })).structuredContent;
    await invoke(h, "select_shop", { deptId: 13 });
    assert.equal((await invoke(h, "confirm_order", { reviewId })).isError, true);
    assert.equal((await invoke(h, "review_order", { ...orderInput, cartRevision: revision })).isError, true);
    assert.equal(h.calls.filter((item) => item.name === "previewOrder").length, 1);
    assert.equal(h.calls.some((item) => item.name === "createOrder"), false);
  } finally { await h.close(); }
});
test("预览进行中换店不会产生可用凭据", async () => {
  let resolvePreview, started; const start = new Promise((resolve) => { started = resolve; });
  const h = await harness({ responses: { previewOrder: async () => { started(); return new Promise((resolve) => { resolvePreview = resolve; }); } } });
  try {
    const pending = invoke(h, "review_order", orderInput); await start;
    await invoke(h, "invalidate_previews"); resolvePreview(preview); assert.equal((await pending).isError, true);
  } finally { await h.close(); }
});
test("取餐画中画仅在 20、30、60 显示，缺字段使用保底版", () => {
  for (const status of [10, 20, 30, 60, 80, 100, 0, null]) assert.equal(pickupState({ orderStatus: status }, 123).visible, [20, 30, 60].includes(status));
  assert.deepEqual(pickupState({ orderStatus: 30 }, 123), { visible: true, status: "制作中", updatedAt: 123, full: false, code: null, aboutTime: null, step: 1 });
  const full = pickupState({ orderStatus: 60, takeMealCodeInfo: { code: "A001" }, aboutTime: 1792729200 });
  assert.equal(full.full, true); assert.equal(full.aboutTime, 1792729200000); assert.equal(full.step, 2);
  assert.equal(pickupState({ orderStatus: 30, takeMealCodeInfo: { unknown: "A001" }, aboutTime: 1792729200 }).full, false);
});
test("仅记录本插件创建的订单，再来一单不调用上游", async () => {
  const h = await harness({ responses: { previewOrder: preview, createOrder: { orderIdStr: "local-order", needPay: true }, queryOrderDetailInfo: { orderStatus: 30 } } });
  try {
    await invoke(h, "order_detail", { orderId: "foreign-order" }); assert.equal(h.local.read("orders", []).length, 0);
    const review = (await invoke(h, "review_order", orderInput)).structuredContent;
    await invoke(h, "confirm_order", { reviewId: review.reviewId }); const before = h.calls.length;
    const replay = (await invoke(h, "reorder", { orderId: "local-order" })).structuredContent;
    assert.deepEqual(replay.data.input, orderInput); assert.equal(h.calls.length, before); assert.equal(h.local.read("orders", []).length, 1);
  } finally { await h.close(); }
});
test("营业时间支持跨午夜，未知时间不猜测；付款链接限制官方域", () => {
  assert.equal(shopSummary({ workTimeStart: "08:00", workTimeEnd: "18:00" }, Date.parse("2026-10-23T07:00:00+08:00")).open, false);
  assert.equal(shopSummary({ workTimeStart: "22:00", workTimeEnd: "06:00" }, Date.parse("2026-10-23T01:00:00+08:00")).open, true);
  assert.equal(shopSummary({}).open, null);
  assert.equal(paymentUrl("https://pay.lkcoffee.com/pay?id=mock"), "https://pay.lkcoffee.com/pay?id=mock");
  for (const url of ["javascript:alert(1)", "https://lkcoffee.com.evil.example/pay", "https://user:pass@pay.lkcoffee.com"]) assert.equal(paymentUrl(url), null);
});
test("HTTP 401 与上游反射的凭据都不会泄露", async () => {
  const http = createServer((req, res) => res.writeHead(401).end("synthetic-secret"));
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  const upstream = new LuckinUpstream({ token: "synthetic-secret", url: `http://127.0.0.1:${http.address().port}/mcp` });
  try {
    await assert.rejects(upstream.call("queryShopList", {}), (error) => error instanceof AuthError && !error.message.includes("synthetic-secret"));
    assert.equal(upstream.authStatus().expired, true);
    assert.deepEqual(upstream.redact({ authorization: "secret", data: ["synthetic-secret"], accessToken: "secret" }), { data: ["[已隐藏]"] });
    await assert.rejects(upstream.call("unsupportedTool", {}), /不支持/);
  } finally { await upstream.close(); await new Promise((resolve) => http.close(resolve)); }
});

test("取消成功但自动查单失败时不伪称已取消", async () => {
  let count = 0;
  const h = await harness({ responses: { queryOrderDetailInfo: () => { if (count++) throw new Error("模拟断网"); return { orderStatus: 30 }; }, cancelOrder: true } });
  try {
    const review = (await invoke(h, "review_cancel", { orderId: "mock" })).structuredContent;
    const receipt = (await invoke(h, "confirm_cancel", { reviewId: review.reviewId })).structuredContent.data;
    assert.equal(receipt.cancelled, true); assert.equal(receipt.orderStatus, undefined); assert.match(receipt.warning, /刷新失败/);
    assert.equal(h.calls.filter((item) => item.name === "queryOrderDetailInfo").length, 2);
  } finally { await h.close(); }
});

test("创建成功但本地写盘失败时仍保留订单回执", async () => {
  const h = await harness({ responses: { previewOrder: preview, createOrder: { orderIdStr: "mock-write-failed", needPay: true } } });
  try {
    const review = (await invoke(h, "review_order", orderInput)).structuredContent;
    h.local.remember = () => { throw new Error("模拟磁盘错误"); };
    const result = await invoke(h, "confirm_order", { reviewId: review.reviewId });
    assert.equal(result.isError, undefined); assert.equal(result.structuredContent.data.orderId, "mock-write-failed");
    assert.match(result.structuredContent.data.warning, /未能保存/);
  } finally { await h.close(); }
});
