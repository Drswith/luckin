import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const OFFICIAL_MCP_URL = "https://gwmcp.lkcoffee.com/order/user/mcp";

export function unwrapOfficialResult(result) {
  if (result?.isError) throw new Error("瑞幸 MCP 返回工具错误。请检查账号授权及参数。 ");
  let payload = result?.structuredContent;
  if (!payload) {
    const text = result?.content?.find((part) => part.type === "text")?.text;
    if (!text) throw new Error("瑞幸 MCP 未返回可读取的结果。");
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("瑞幸 MCP 返回格式无法识别。");
    }
  }
  if (payload.success === false || (payload.code !== undefined && payload.code !== 0)) {
    throw new Error(`瑞幸请求失败：${String(payload.msg ?? "未知错误")}`);
  }
  return payload.data ?? payload;
}

export class LuckinUpstream {
  constructor({ token = process.env.LUCKIN_MCP_TOKEN, url = OFFICIAL_MCP_URL } = {}) {
    this.token = token;
    this.url = url;
    this.client = null;
  }

  async connect() {
    if (!this.token) throw new Error("缺少 LUCKIN_MCP_TOKEN。请先在瑞幸 AI 开放平台创建 Token 并配置到本地进程环境。");
    if (this.client) return this.client;
    const client = new Client({ name: "luckin", version: "0.1.8" });
    const transport = new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: { headers: { Authorization: `Bearer ${this.token}` } },
    });
    try {
      await client.connect(transport);
      this.client = client;
      return client;
    } catch (error) {
      await client.close().catch(() => {});
      const detail = (error instanceof Error ? error.message : String(error)).replaceAll(this.token, "[REDACTED]");
      throw new Error(`无法连接瑞幸 MCP：${detail}`);
    }
  }

  async call(name, args) {
    const client = await this.connect();
    return unwrapOfficialResult(await client.callTool({ name, arguments: args }));
  }

  async close() {
    await this.client?.close();
    this.client = null;
  }
}
