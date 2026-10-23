const bridge = { capabilities: {}, context: {}, onResult: () => {
}, onAuth: () => {
}, onContext: () => {
} };
const pendingRequests = /* @__PURE__ */ new Map();
let rpcId = 0, hostTheme = null;
function applyTheme(theme) {
  if (["light", "dark"].includes(theme)) {
    hostTheme = theme;
    document.documentElement.dataset.theme = theme;
  }
}
applyTheme(window.openai?.theme);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
  if (!hostTheme) document.documentElement.dataset.theme = event.matches ? "dark" : "light";
});
bridge.request = (method, params) => new Promise((resolve, reject) => {
  const id = ++rpcId;
  const timer = setTimeout(() => {
    pendingRequests.delete(id);
    reject(new Error("客户端响应超时，请重试；提交订单后请先查询状态。"));
  }, 15e3);
  pendingRequests.set(id, { resolve, reject, timer });
  window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
});
window.addEventListener("message", (event) => {
  if (event.source !== window.parent || event.data?.jsonrpc !== "2.0") return;
  const message = event.data;
  if (message.method === "ui/notifications/host-context-changed") {
    Object.assign(bridge.context, message.params);
    applyTheme(message.params?.theme);
    bridge.onContext(message.params || {});
  } else if (message.method === "ui/notifications/tool-result") bridge.onResult(message.params?.structuredContent);
  else if (message.id && !message.method) {
    const pending = pendingRequests.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingRequests.delete(message.id);
    // 宿主错误可能反射调用参数，不展示原始正文。
    message.error ? pending.reject(new Error("客户端未能完成此操作。")) : pending.resolve(message.result);
  }
});
bridge.ready = bridge.request("ui/initialize", {
  appInfo: { name: "luckin", version: "0.2.0" },
  appCapabilities: { availableDisplayModes: ["inline", "fullscreen", "pip"] },
  protocolVersion: "2026-01-26"
}).then((result) => {
  bridge.capabilities = result.hostCapabilities || {};
  bridge.context = result.hostContext || {};
  applyTheme(bridge.context.theme);
  window.parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} }, "*");
  return true;
}).catch(() => false);
bridge.call = async (name, args = {}) => {
  if (!await bridge.ready) throw new Error("客户端不支持确认界面，请在支持 MCP Apps 的客户端中打开。");
  const response = await bridge.request("tools/call", { name, arguments: args });
  const data = response?.structuredContent || {};
  if (response?.isError) {
    if (data.kind === "auth") bridge.onAuth(data);
    const error = new Error(data.message || "操作失败，请重试。");
    error.result = data;
    throw error;
  }
  return data;
};
bridge.openShop = async (args = {}) => {
  if (!await bridge.ready) throw new Error("客户端不支持应用界面。");
  if (bridge.capabilities.message?.text) {
    try {
      const sent = await bridge.request("ui/message", { role: "user", content: [{ type: "text", text: `请调用 open_luckin 打开选购面板，参数：${JSON.stringify(args)}。只选择商品，不创建订单。` }] });
      if (!sent?.isError) return;
    } catch {}
  }
  const path = `/shop?${new URLSearchParams(args)}`;
  await bridge.openLink(`codex://plugins/luckin@luckin-community/app/open_luckin?path=${encodeURIComponent(path)}`);
};
bridge.openLink = async (url) => {
  const response = await bridge.request("ui/open-link", { url });
  if (response?.isError) throw new Error("客户端未能打开链接，请手动打开相应应用或官方网页。");
};
function authForm(container, info, connected) {
  container.replaceChildren();
  const heading = document.createElement("strong"), note = document.createElement("p"), form = document.createElement("form");
  heading.textContent = "粘贴瑞幸开放平台 Token";
  note.textContent = "在瑞幸 AI 开放平台获取 Token，仅粘贴到此密码框。凭据只保存到本机，不要发到对话。";
  const label = document.createElement("label"), input = document.createElement("input"), submit = document.createElement("button"), message = document.createElement("p");
  input.type = "password";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.required = true;
  input.maxLength = 8192;
  input.setAttribute("aria-label", "瑞幸 Token");
  input.placeholder = "粘贴 Token";
  label.append(input);
  submit.type = "submit";
  submit.className = "primary";
  submit.textContent = "保存并连接";
  message.setAttribute("role", "status");
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    let token = input.value.trim();
    input.value = "";
    if (!token) return;
    submit.disabled = true;
    message.textContent = "正在连接…";
    try {
      await bridge.call("save_token", { token });
      token = "";
      container.replaceChildren(Object.assign(document.createElement("strong"), { textContent: "已连接" }));
      await connected();
    } catch {
      message.textContent = "连接失败，请检查凭据、网络或本地文件权限后重新输入。";
    } finally {
      token = "";
      input.value = "";
      submit.disabled = false;
    }
  };
  const platform = document.createElement("button");
  platform.type = "button";
  platform.className = "secondary";
  platform.textContent = "打开瑞幸开放平台 ↗";
  platform.onclick = async () => {
    try {
      await bridge.openLink("https://open.lkcoffee.com/mcp");
    } catch {
      message.textContent = "请在系统浏览器打开 open.lkcoffee.com/mcp。";
    }
  };
  const actions = document.createElement("div");
  actions.className = "auth-actions";
  actions.append(platform, submit);
  form.append(label, actions);
  container.append(heading, note, form, message);
}
