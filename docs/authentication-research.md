# 认证与宿主能力调研

核对日期：2026-10-23。只读取公开网页、公开安装脚本与下载清单，没有执行安装脚本、运行登录、读取用户官方 CLI 凭据或连接真实账号。

## 官方 CLI 的可确认事实

- [CLI 页面](https://open.lkcoffee.com/cli)给出 `curl -fsSL https://open.lkcoffee.com/install | bash` 安装入口。[安装脚本](https://open.lkcoffee.com/install)读取生产[下载清单](https://open.lkcoffee.com/cli/manifest.json)。当日清单版本为 `0.0.1`，包含各平台二进制地址及 SHA-256；本机 PATH 未找到 `luckin`。
- 公开 CLI 页面、安装脚本、下载清单与官网前端资源没有提供可确认的登录 Token 文件路径、序列化格式或第三方读取契约。**文件位置、格式：均未确认**。不根据文件名猜测 `~/.luckin`、JSON 字段或钥匙串条目。
- 官网登录界面链接到[用户协议](https://m.lkcoffee.com/appClient/helpCenter/memberAgreement)及[隐私权政策](https://m.lkcoffee.com/appClient/helpCenter/privacyAgreement)。查看到的用户协议更新于 2024-11-29；现有证据不足以确认第三方插件自动读取 CLI 登录凭据被允许。**第三方读取许可：未确认**，这不是法律合规结论。

因此本版不提供“在浏览器中登录瑞幸”自动登录按钮，不执行 `luckin login`，也不监听或自动读取官方 CLI 的凭据。未来只有在存储契约、使用条款和系统默认浏览器行为都核实后才能接入。此次按设计允许的降级路径，仅实现手动密码框和环境变量。

## 本插件手动连接

用户自行从瑞幸开放平台获取 Token，在 MCP Apps 密码输入框中粘贴，直接调用 `visibility: ["app"]` 的 `save_token`。输入提交时立即清空，禁止回显、写入聊天消息或记录日志。保存前完成 MCP 连接初始化；一次实际只读查询才证明具体业务工具可用。

本插件写入 `~/.config/luckin-community/credentials.json`，格式为仅含 `token` 的 JSON 对象。目录权限为 700，文件为 600，通过同目录临时文件和原子替换写入；不在仓库或安装包中存储。门店、搜索和本插件订单分别保存在同目录的 `shops.json`、`searches.json`、`orders.json`（同为 600）。订单最多保留 50 条，门店和搜索各 8 条；只有成功创建的订单会进入列表，任意查单不会扩充为账号历史。文件读取失败不会静默覆盖原记录。

启动时优先使用 `LUCKIN_MCP_TOKEN`，没有环境变量时才读取本插件凭据文件。用户在界面重新连接后，当前进程使用新凭据；若仍保留旧环境变量，下次启动会再次以环境变量优先，应同步更新或移除旧值。官方未提供可核实有效期时，不显示剩余天数。401 转成“登录已失效 → 重新登录”，只恢复只读请求，创建和取消不自动重放。新凭据保存后所有旧确认凭据失效。

错误正文不转发 HTTP/SDK 的原始异常，上游响应中的 Token 字段及当前 Token 字符串会过滤。这里的 `visibility` 由兼容宿主执行，本地 stdio 进程本身不能证明调用一定来自真人点击，也不能约束不可信宿主对 RPC 参数的记录行为。

## 宿主支持与回退

[OpenAI MCP Extensions 规范](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md)注册 `global` / `thread` 入口；thread 入口是用户可打开的会话内容标签。规范当日只承诺 `inline/fullscreen`，明确不承诺 `pip`。另一方面，[运行时参考](https://developers.openai.com/plugins/reference)仍列出 `window.openai.requestDisplayMode` 和 `requestModal`。

- 资源的 OpenAI metadata 只声明其规范接受的 inline/fullscreen；MCP Apps 初始化声明 inline/fullscreen/pip 三种应用能力，实际 PiP 只在宿主公布支持、或提供旧运行时方法时请求；不支持时继续显示内联取餐状态，45 秒刷新一次。不能用本机模拟测试声称 Codex 已支持 PiP。
- 从内联“选规格”发送 `ui/message`，请宿主调用带门店和商品参数的 `open_luckin`；宿主决定实际面板位置。无消息能力时使用已文档化的插件 deep link 打开同一应用。当前没有找到可移植的“强制打开 thread 标签”API，因此不虚构 API，具体是否落到会话侧面板仍需客户端验收。
- `requestModal` 仅从内联“换店”触发，使用同一选店界面的专用资源；不支持或调用失败时请求打开选购面板并展开门店条。面板内换店始终就地展开。
- 预览优先走 `ui/message`，不支持或返回失败时在面板中直接显示确认。工具层仍保持一次性确认，不能因回退而自动创建订单。
- 手动连接的开放平台链接、支付链接通过 `ui/open-link`；具体打开侧边浏览器还是系统浏览器由宿主决定，尚未验收。没有将其描述为已经实现系统浏览器 CLI 登录。

本次网络核对：瑞幸官网与下载清单直连可用；GitHub raw 直连超时，在检查本机系统代理及 hosts 后，单次代理访问成功。没有持久化临时代理端口或凭据。
