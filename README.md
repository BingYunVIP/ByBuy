# ByBuy

ByBuy 是 **AI代充** 的 ChatGPT 自助充值前后端项目：浏览器提交兑换卡密与 Session，
服务端完成订阅校验、卡密验证、订单提交与进度查询。

**生产站点：<https://buy.bingyun.vip>**

前端 React 19 + Vite，后端 Express（Node.js 24+），前后端共用一个端口，
由同一个进程提供页面与接口。

## 项目功能

**充值流程（三步）**

1. 检查订阅 —— 粘贴或导入 ChatGPT 的 Session JSON，服务端在线核验账号类型与套餐，
   只接受个人 Free 账号（Plus / Team / Pro 会给出明确提示）。
2. 验证卡密 —— 校验兑换卡密是否有效可用，通过后进入提交页。卡密套餐只显示 Go、Plus、Pro
   三种名称（Pro 的各个档位统一显示为 Pro）；续费卡与 Codex 点数卡不在服务范围内，
   验证和订单查询时会明确提示「该类型卡密暂不支持在本站使用」。
3. 完成提交 —— 提交充值申请；若需要 3D Secure 验证，页面内直接完成，无需跳转外部收银台。
   验证的进度（出现 / 开始 / 成功 / 失败）会自动回报给充值服务，只包含卡密和事件类型，不含 Session。

**订单查询**

- 用原卡密查询订单状态：等待处理 / 处理中 / 已完成 / 未完成。
- 结果页给出充值账号、订单尾号、卡密（中间打码）与「提交订单 → 开始处理 → 充值完成」时间轴。
- 处理中的订单会自动轮询刷新，无需手动反复点。

**页面与体验**

- 套餐信息：Plus、Pro 5x、Pro 10x、Pro 25x。
- 顶部导航：订单查询、全球价格对比、AI 中转站、冰云小店（卡密购买）、售后群、联系邮箱。
- 充值须知按「先确认账号 / 请勿提交 / 建议与保障」三组分级展示。
- 中文 / 英文切换，深色 / 浅色切换（默认深色），移动端自适应。

**服务可用性**

- 顶栏常驻「系统状态」指示灯，后端定时探测充值服务并只向前端暴露可用状态与延迟。
- 服务异常时，充值卡与订单卡会整体停用并给出重新检测入口，
  避免用户填完表单才收到「暂时无法连接」。

**安全与隐私**

- 全程 HTTPS；生产环境由服务端下发 CSP、`X-Frame-Options: DENY` 等安全响应头。
- Session JSON 只在内存中校验并转发到充值服务，不写入数据库、文件或应用日志；
  提交后前端立即清除输入。
- 日志只记录阶段、路径、状态、耗时、客户端 IP 与错误码，不记录请求体、卡密或 Token。

**订阅核验**

- 浏览器解析 Session 后，仅把访问令牌和账号标识提交到同源 `/api/subscriptions/check`。
- 服务端通过 ChatGPT 的只读账号/工作区检查取得当前套餐，并要求在线结果与 Session 中的账号标识精确匹配。
- 网络中断、超时或 ChatGPT `5xx` 会在总超时时间内自动重试一次；`401`、`403`、`429` 和无法识别的响应不会盲目重试。
- 只有在线明确确认 `personal + free` 才会签发短期验证凭证；本地 JWT 套餐标记、缺失账号结构或冲突记录均不能放行卡密验证。

## 环境要求

- Linux（`ByBuy.sh` 仅支持 Linux）
- Node.js `>= 24.5.0`（脚本会自动检测，不满足时下载官方 Node.js 到项目私有目录 `.runtime/`）
- 一个指向本机端口的 HTTPS 反向代理（Caddy / Nginx 均可，用于绑定域名与证书）
- 已确认可用的充值服务 HTTPS Origin

## 一键部署

```bash
git clone https://github.com/BingYunVIP/ByBuy.git
cd ByBuy
chmod +x ByBuy.sh
./ByBuy.sh
```

脚本会显示管理菜单：

```text
1. 安装 / 重新部署
2. 更新到最新版本
3. 重启服务
4. 查看服务状态
5. 查看最近日志
0. 退出
```

首次部署选择 `1`。`ByBuy.sh` 会依次完成：

1. 检查并补齐基础工具（curl / tar / xz / ss / ip 等），必要时调用系统包管理器安装。
2. 检测 Node.js 版本；低于 24.5.0 时下载官方 v24 二进制（带 SHA-256 校验）到 `.runtime/node`。
3. 由 `.env.example` 生成 `.env`（权限 `600`），首次运行会交互式询问充值服务 HTTPS Origin。
4. 停止上一版本进程，再检查监听端口；端口被占用时自动改选空闲端口并写回 `.env`。
5. 安装依赖、运行单元测试、生成生产构建。
6. 默认安装并启动 `bybuy.service`；系统未使用 systemd 时自动回退为后台进程。
7. 健康检查通过后打印实际监听地址与日志查看命令。

## 配置

生产配置保存在不纳入版本控制的 `.env` 中（权限 `600`）：

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `HOST` | 服务监听地址 | `0.0.0.0` |
| `PORT` | 服务监听端口 | `2254` |
| `UPSTREAM_ORIGIN` | 充值服务 HTTPS Origin；支持逗号分隔的主备地址 | 必填 |
| `PUBLIC_ORIGIN` | 公网站点 Origin，用于同源请求校验 | 未设置 |
| `TRUST_PROXY` | 可信反向代理范围 | 未设置 |
| `HTTP_PROXY` / `HTTPS_PROXY` | 可选；Node.js 访问外网时使用的受信任代理 | 未设置 |
| `NO_PROXY` | 可选；不经过代理的主机列表 | 未设置 |
| `UPSTREAM_TIMEOUT_MS` | 远程请求超时，单位毫秒 | `25000` |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` / `silent` | `info` |
| `SERVICE_DIAGNOSTICS` | 是否记录额外诊断元数据 | `0` |
| `UPSTREAM_CONCURRENCY` | 单进程远程请求并发上限 | `8` |
| `UPSTREAM_QUEUE` | 并发闸门等待队列上限 | `100` |
| `UPSTREAM_QUEUE_WAIT_MS` | 最大排队时间，单位毫秒 | `8000` |

**`TRUST_PROXY` 必须设置。** 反向代理后面不打开它，`req.ip` 永远是反代的地址，
所有用户共用一个限流桶 —— 一个人点快了，其他人都会收到「操作较频繁」。
本机反代填 `loopback`。

如果服务器直连 ChatGPT 超时，而当前终端已经配置 `HTTP_PROXY`、`HTTPS_PROXY` 或 `NO_PROXY`，
`ByBuy.sh` 会在首次发现 `.env` 尚未配置这些变量时安全写入它们。代理值不会进入安装日志，
`.env` 权限保持为 `600`。只应使用自己信任并获准使用的代理；需要更换代理时直接修改 `.env` 后重启服务。

## HTTPS 反向代理

仓库提供 [`deploy/Caddyfile`](deploy/Caddyfile)，默认把 `buy.bingyun.vip` 转发到 `127.0.0.1:2254`。
若 `ByBuy.sh` 自动改选了其他端口，请同步修改反代目标。

```caddyfile
buy.bingyun.vip {
    encode zstd gzip
    reverse_proxy 127.0.0.1:2254 {
        transport http {
            response_header_timeout 70s
        }
    }
}
```

应用配置：

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

## 更新

进入项目目录并打开菜单：

```bash
cd /root/ByBuy
./ByBuy.sh
```

选择 `2. 更新到最新版本`。脚本会自动：

1. 检查并下载 GitHub 最新代码。
2. 保护 `.env`、日志和运行数据。
3. 发现本地文件修改时停止覆盖；如果只修改过 `ByBuy.sh`，会先备份并询问是否替换。
4. 运行测试和生产构建。
5. 保持原端口并重启服务。
6. 执行健康检查并显示结果。

从旧版脚本首次切换到管理菜单时，在项目目录执行一次：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/BingYunVIP/ByBuy/main/ByBuy.sh)
```

然后选择 `2`。完成这一次切换后，后续始终只需要运行 `./ByBuy.sh`。

## 运维

运行管理菜单：

```bash
cd /root/ByBuy
./ByBuy.sh
```

菜单可以直接完成重启、状态检查和日志查看。后台进程模式的日志位于 `logs/runtime.log`，
PID 位于 `run/bybuy.pid`。

安装日志写入 `logs/install-*.log`（每次运行一份）。应用日志按
`LIFECYCLE`、`HTTP`、`SECURITY`、`SUBSCRIPTION`、`ORDER`、`REMOTE`、`HEALTH`、`ERROR` 分类。
`ORDER` 分类包含订单提交与安全验证进度回报（`VERIFICATION_EVENT`），只记录事件类型，不记录卡密。

订阅检查失败时，可先查看最近的脱敏结果：

```bash
journalctl -u bybuy -n 100 -o cat | grep '"category":"SUBSCRIPTION"'
```

`SUBSCRIPTION` 日志只包含凭证是否被接受、检查结果、是否签发验证凭证及错误代码，
不包含账号 ID、邮箱、访问令牌或 Session JSON。

## 本地开发

```bash
npm ci
cp .env.example .env      # 填写 UPSTREAM_ORIGIN
npm run dev               # Vite 中间件 + 后端，单端口
```

检查：

```bash
npm test                  # 单元测试
npm run build             # 类型检查 + 生产构建 + 产物泄漏检查
curl http://127.0.0.1:2254/api/health
```
