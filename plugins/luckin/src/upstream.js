import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const OFFICIAL_MCP_URL = "https://gwmcp.lkcoffee.com/order/user/mcp";
export const OFFICIAL_TOOLS = ["queryShopList", "searchProductForMcp", "queryProductDetailInfo", "switchProduct", "previewOrder", "createOrder", "queryOrderDetailInfo", "cancelOrder"];
export class AuthError extends Error {
  constructor(expired = true) {
    super(expired ? "登录已失效 → 重新登录" : "尚未连接瑞幸，请在界面中连接账号。");
    this.expired = expired;
  }
}
const unauthorized = (error) => [error?.code, error?.status, error?.statusCode, error?.response?.status].some((code) => Number(code) === 401) || /\b401\b|访问令牌无效|token.{0,20}(invalid|expired)/i.test(String(error?.message ?? ""));

export function unwrapOfficialResult(result) {
  let payload = result?.structuredContent;
  if (!payload) {
    const text = result?.content?.find((part) => part.type === "text")?.text;
    if (!text) throw new Error("瑞幸 MCP 未返回可读取的结果。");
    try { payload = JSON.parse(text); }
    catch {
      if (unauthorized({ message: text })) throw new AuthError();
      throw new Error("瑞幸 MCP 返回格式无法识别。");
    }
  }
  if (unauthorized({ ...payload, message: payload.msg })) throw new AuthError();
  if (result?.isError || payload.success === false || (payload.code !== undefined && Number(payload.code) !== 0)) {
    throw new Error("瑞幸请求失败，请检查账号授权及参数。");
  }
  return payload.data ?? payload;
}

export class LuckinUpstream {
  constructor({ token = process.env.LUCKIN_MCP_TOKEN, url = OFFICIAL_MCP_URL } = {}) {
    this.token = token;
    this.url = url;
    this.client = null;
    this.connecting = null;
    this.expired = false;
  }

  authStatus() { return { connected: Boolean(this.token) && !this.expired, expired: this.expired }; }

  async setToken(token) {
    await this.close();
    this.token = token;
    this.expired = false;
    try { await this.connect(); }
    catch (error) { this.token = undefined; throw error; }
  }

  async connect() {
    if (!this.token || this.expired) throw new AuthError(this.expired);
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = this.open();
    try { return await this.connecting; }
    finally { this.connecting = null; }
  }

  async open() {
    const client = new Client({ name: "luckin", version: "0.2.0" });
    const transport = new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: { headers: { Authorization: `Bearer ${this.token}` } },
    });
    try {
      await client.connect(transport);
      this.client = client;
      return client;
    } catch (error) {
      await client.close().catch(() => {});
      if (unauthorized(error)) { this.expired = true; throw new AuthError(); }
      throw new Error("无法连接瑞幸，请检查网络后重试。");
    }
  }

  redact(value) {
    if (typeof value === "string") return this.token ? value.replaceAll(this.token, "[已隐藏]") : value;
    if (Array.isArray(value)) return value.map((item) => this.redact(item));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !/token|authorization|cookie/i.test(key)).map(([key, item]) => [key, this.redact(item)]));
    return value;
  }

  async call(name, args) {
    if (!OFFICIAL_TOOLS.includes(name)) throw new Error("不支持此瑞幸工具。");
    try {
      const client = await this.connect();
      return this.redact(unwrapOfficialResult(await client.callTool({ name, arguments: args })));
    } catch (error) {
      if (error instanceof AuthError || unauthorized(error)) {
        this.expired = error.expired !== false;
        await this.close().catch(() => {});
        throw new AuthError(this.expired);
      }
      // 不向界面转发传输异常或上游错误正文，避免凭据被反射。
      throw new Error("无法连接瑞幸或请求失败，请检查网络与参数后重试。");
    }
  }

  async close() {
    await this.client?.close();
    this.client = null;
  }
}
