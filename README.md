<p align="center">
  <img src="public/logo.png" alt="ByBuy" width="96" />
  <br />
  <b>简体中文</b> | <a href="README_en.md">English</a> | 站点：<a href="https://buy.bingyun.vip">buy.bingyun.vip</a>
</p>

## 项目功能

- **三步充值**：检查订阅（粘贴 Session JSON，服务端在线核验）→ 验证卡密 → 完成提交，需要 3D Secure 时在页面内直接完成。
- **订单查询**：用原卡密查看进度（等待处理 / 处理中 / 已完成 / 未完成），处理中的订单自动刷新。
- **订阅核验**：只接受个人 Free 账号，服务端在线确认 `personal + free` 后才签发短期验证凭证。
- **隐私保护**：Session 只在内存中校验并转发给充值服务，不落库、不写日志，提交后前端立即清除。
- **脱敏日志**：ChatGPT 与 Team 的验卡、查询、提交、兑换都会记录（`service` 字段区分）。卡密只记带盐的短指纹，邮箱打码，IP 只留前两段，密码、令牌、Session 一律不写。
- **界面**：中英文双语、深浅主题，语言自动跟随浏览器，移动端自适应。

## 页面入口

- `/chatgpt`：ChatGPT 充值与订单查询，根路径会跳转到这里。
- `/team`：Team 兑换，支持邮箱邀请和领取现成账号两种方式。需要配置 `Team_Web`，未配置时页面显示「暂未开放」。
- `/chatgpt` 与 `/team` 共用同一套版式和蓝白配色，卡片宽高随浏览器窗口自动适配。

## 环境要求

- Linux（`ByBuy.sh` 仅支持 Linux）
- Node.js `>= 24.5.0`（不满足时脚本自动下载官方 Node.js 到 `.runtime/`）
- 已确认可用的充值服务 HTTPS Origin

## 一键部署

```bash
git clone https://github.com/BingYunVIP/ByBuy.git
cd ByBuy
chmod +x ByBuy.sh
./ByBuy.sh
```

```text
1. 安装 / 重新部署
2. 更新到最新版本
3. 重启服务
4. 查看服务状态
5. 查看最近日志
0. 退出
```

首次部署选 `1`。脚本会依次完成：检查并补齐基础工具 → 检测 Node.js 版本（低于 24.5.0 时下载官方 v24 并校验 SHA-256）→ 由 `.env.example` 生成 `.env`（权限 `600`，首次运行询问充值服务 Origin）→ 安装依赖、运行测试、生产构建 → 安装并启动 `bybuy.service`（无 systemd 时回退后台进程）→ 健康检查通过后打印监听地址。

后续升级选 `2`，脚本会保留 `.env`、日志与运行数据，重新构建并重启。

## 配置

生产配置保存在不纳入版本控制的 `.env`（权限 `600`）：

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `HOST` | 服务监听地址 | `0.0.0.0` |
| `PORT` | 服务监听端口 | `2254` |
| `ChatGPT_Web` | 充值服务 HTTPS Origin；支持逗号分隔的主备地址 | 必填 |
| `PUBLIC_ORIGIN` | 公网站点 Origin，用于同源请求校验 | 未设置 |
| `TRUST_PROXY` | 可信代理范围 | 未设置 |
| `HTTP_PROXY` / `HTTPS_PROXY` | 可选；访问外网时使用的受信任代理 | 未设置 |
| `NO_PROXY` | 可选；不经过代理的主机列表 | 未设置 |
| `UPSTREAM_TIMEOUT_MS` | 远程请求超时，单位毫秒 | `25000` |
| `Team_Web` | Team 兑换公开接口的 HTTPS Origin（服务端代理） | 未设置（Team 兑换显示「暂未开放」） |
| `TEAM_REDEEM_TIMEOUT_MS` | Team 接口超时，单位毫秒 | `15000` |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` / `silent` | `info` |
| `LOG_SALT` | 卡密指纹的盐。固定后，重启前后同一张卡的日志仍可关联；留空则每次启动随机生成 | 留空 |
| `SERVICE_DIAGNOSTICS` | 是否记录额外诊断元数据 | `0` |
| `UPSTREAM_CONCURRENCY` | 单进程远程请求并发上限 | `8` |
| `UPSTREAM_QUEUE` | 并发闸门等待队列上限 | `100` |
| `UPSTREAM_QUEUE_WAIT_MS` | 最大排队时间，单位毫秒 | `8000` |

**`TRUST_PROXY` 必须设置**，否则所有访客共用一个限流桶——一个人点快了，其他人都会收到「操作较频繁」。本机填 `loopback`。

若服务器直连 ChatGPT 超时，而当前终端已配置 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`，`ByBuy.sh` 会在首次发现 `.env` 未配置时安全写入，代理值不会进入安装日志。

## 本地开发

```bash
npm ci
cp .env.example .env      # 填写 ChatGPT_Web
npm run dev               # Vite 中间件 + 后端，单端口
```

Team 页面通过 ByBuy 同源接口读取库存并兑换；卡密和账号凭据只在请求或页面内存中处理，不写入日志或持久化存储。上游网址只写在 `.env`，不会出现在浏览器里。

```bash
npm test                  # 单元测试
npm run build             # 类型检查 + 生产构建 + 产物泄漏检查
curl http://127.0.0.1:2254/api/health
```
