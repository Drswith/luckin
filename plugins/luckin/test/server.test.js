import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createLuckinServer } from "../src/server.js";
import { ReviewStore } from "../src/reviews.js";
import { catalogSummary, officialProductImage } from "../src/products.js";
import { LuckinUpstream, unwrapOfficialResult } from "../src/upstream.js";

async function harness({ responses, now } = {}) {
  const calls = [];
  const upstream = {
    async call(name, args) {
      calls.push({ name, args });
      const response = responses?.[name];
      if (response === undefined) throw new Error(`Unexpected upstream call: ${name}`);
      return typeof response === "function" ? response(args) : response;
    },
  };
  const server = createLuckinServer({ upstream, reviews: new ReviewStore({ now: () => now.value }) });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, calls, close: async () => { await client.close(); await server.close(); } };
}

const preview = {
  discountPrice: 16,
  shopInfo: { deptId: 12, deptName: "测试门店", address: "测试地址", longitude: 116.39, latitude: 39.98 },
  productInfoList: [{ productId: 34, skuCode: "SKU-1", name: "冰美式", amount: 1, additionDesc: "少冰", estimateTotalPrice: 16, breviaryPicUrl: "https://imgtest03.luckincoffeecdn.com/coffee.jpg" }],
  couponCodeList: ["C1"],
};
const orderInput = { deptId: 12, productList: [{ amount: 1, productId: 34, skuCode: "SKU-1" }] };

test("catalog keeps official images and excludes other hosts", () => {
  assert.equal(officialProductImage("https://imgtest03.luckincoffeecdn.com/coffee.jpg"), "https://imgtest03.luckincoffeecdn.com/coffee.jpg");
  assert.equal(officialProductImage("https://luckincoffeecdn.com.evil.example/coffee.jpg"), null);
  assert.equal(officialProductImage("http://imgtest03.luckincoffeecdn.com/coffee.jpg"), null);
  assert.deepEqual(catalogSummary([{ productId: 34, productName: "冰美式", pictureUrl: "https://imgtest03.luckincoffeecdn.com/coffee.jpg", estimatePrice: 16 }]), [{
    productId: 34, name: "冰美式", imageUrl: "https://imgtest03.luckincoffeecdn.com/coffee.jpg", price: 16, tags: "",
  }]);
});

test("shop entrypoints and product search expose official images", async () => {
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
    assert.deepEqual((await h.client.callTool({ name: "open_luckin", arguments: {} })).structuredContent, { kind: "shop" });
    const result = await h.client.callTool({ name: "search_products", arguments: { deptId: 12, query: "冰美式" } });
    assert.equal(result.structuredContent.products[0].imageUrl, "https://imgtest03.luckincoffeecdn.com/coffee.jpg");
    assert.equal(result.structuredContent.data[0].skuCode, "SKU-1");
    const resource = await h.client.readResource({ uri: entry._meta.ui.resourceUri });
    const contentHash = createHash("sha256").update(resource.contents[0].text).digest("hex").slice(0, 12);
    assert.equal(entry._meta.ui.resourceUri, `ui://luckin/shop-${contentHash}.html`);
    assert.deepEqual(resource.contents[0]._meta.ui.csp.resourceDomains, ["https://*.luckincoffeecdn.com", "https://web.luckincdn.com"]);
    assert.deepEqual(resource.contents[0]._meta["openai/ui"].availableDisplayModes, ["fullscreen", "inline"]);
    assert.match(resource.contents[0].text, /在对话中预览订单/);
    assert.match(resource.contents[0].text, /luckincoffeecdn\.com/);
  } finally { await h.close(); }
});

test("official response parsing rejects business errors", () => {
  assert.deepEqual(unwrapOfficialResult({ content: [{ type: "text", text: JSON.stringify({ code: 0, success: true, data: [1] }) }] }), [1]);
  assert.throws(() => unwrapOfficialResult({ structuredContent: { code: 401, success: false, msg: "expired" } }), /expired/);
});

test("HTTP adapter forwards the bearer token and calls the official tool name", async () => {
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

test("review shows a real preview; app confirmation creates at most one order", async () => {
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
    assert.deepEqual(resource.contents[0]._meta["openai/ui"].availableDisplayModes, ["inline"]);
  } finally { await h.close(); }
});

test("expired reviews cannot create orders", async () => {
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

test("orders without a valid preview price cannot be confirmed", async () => {
  const h = await harness({ now: { value: 1000 }, responses: { previewOrder: { ...preview, discountPrice: undefined } } });
  try {
    const result = await h.client.callTool({ name: "review_order", arguments: orderInput });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /有效实付金额/);
    assert.deepEqual(h.calls.map((call) => call.name), ["previewOrder"]);
  } finally { await h.close(); }
});

test("cancel requires review and app confirmation", async () => {
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
  } finally { await h.close(); }
});

test("cancel result is not reported as successful when Luckin returns false", async () => {
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
