# ByBuy

ByBuy 是 AI代充（AITop-Up）的 ChatGPT 自助充值前后端项目。

**生产站点：<https://buy.bingyun.vip>**

## 页面内容

- Plus、Pro 5x、Pro 20x、Pro 25x 套餐信息
- Session JSON 获取教程与订阅状态检查
- 卡密验证、充值提交和订单进度查询
- 充值注意事项、中文/英文和深色/浅色模式

## 一键部署

```bash
git clone https://github.com/BingYunVIP/ByBuy.git
cd ByBuy
chmod +x ByBuy.sh
./ByBuy.sh
```

`ByBuy.sh` 用于 Linux 生产部署，执行内容包括：

- 检查并补齐基础工具；检查 Node.js `>= 24.5.0`，必要时安装项目私有运行时
- 创建并保护 `.env`，交互式读取充值服务 HTTPS Origin
- 检查监听端口；端口被占用时自动选择空闲端口
- 安装依赖、运行测试并生成生产构建
- 默认安装并启动 `bybuy.service`；无 systemd 时回退为后台进程
- 健康检查通过后打印实际 IP、端口及日志命令

可通过环境变量跳过 systemd 询问：

```bash
BYBUY_ENABLE_SERVICE=1 ./ByBuy.sh  # systemd
BYBUY_ENABLE_SERVICE=0 ./ByBuy.sh  # 后台进程
```

systemd 运维命令：

```bash
systemctl status bybuy
systemctl restart bybuy
journalctl -u bybuy -f -o cat
```

后台进程日志位于 `logs/runtime.log`，PID 位于 `run/bybuy.pid`。安装日志写入 `logs/install-*.log`。

## Docker Compose

```bash
git clone https://github.com/BingYunVIP/ByBuy.git
cd ByBuy
cp .env.example .env
chmod 600 .env
# 编辑 .env，将 UPSTREAM_ORIGIN 替换为实际 HTTPS Origin
docker compose up -d --build
```

默认仅监听宿主机 `127.0.0.1:2254`：

```bash
curl http://127.0.0.1:2254/api/health
docker compose logs -f --tail=100 bybuy
docker compose restart bybuy
docker compose down
```

## HTTPS 反向代理

仓库提供 [`deploy/Caddyfile`](deploy/Caddyfile)，默认将 `buy.bingyun.vip` 转发至 `127.0.0.1:2254`。使用 `ByBuy.sh` 自动选择其他端口后，应同步修改反向代理目标。

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

应用 Caddy 配置：

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

## 配置

生产配置保存在未纳入版本控制的 `.env` 中：

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `HOST` | 服务监听地址 | `0.0.0.0` |
| `PORT` | 服务监听端口 | `2254` |
| `UPSTREAM_ORIGIN` | 充值服务 HTTPS Origin；支持逗号分隔的主备地址 | 必填 |
| `PUBLIC_ORIGIN` | 公网站点 Origin，用于同源请求校验 | 未设置 |
| `TRUST_PROXY` | 可信反向代理范围 | 未设置 |
| `UPSTREAM_TIMEOUT_MS` | 远程请求超时，单位毫秒 | `25000` |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` / `silent` | `info` |
| `SERVICE_DIAGNOSTICS` | 是否记录额外诊断元数据 | `0` |
| `UPSTREAM_CONCURRENCY` | 单进程远程请求并发上限 | `8` |
| `UPSTREAM_QUEUE` | 并发闸门等待队列上限 | `100` |
| `UPSTREAM_QUEUE_WAIT_MS` | 最大排队时间，单位毫秒 | `8000` |

本机 Caddy/Nginx 反代通常设置 `TRUST_PROXY=loopback`。Docker Compose 已配置默认 Docker 私有网段。未正确设置时，多名客户可能共用同一个限流 IP。

## 数据与日志

- Session JSON 由浏览器提交至 ByBuy，服务端在内存中校验并转发到 `.env` 指定的充值服务。
- 项目不将 Session JSON 写入数据库、文件或应用日志；请求完成后前端清除对应输入。
- 日志仅记录请求阶段、路径、状态、耗时、客户端 IP 和错误代码，不记录请求体、卡密或 Token。
- 日志按 `LIFECYCLE`、`HTTP`、`SECURITY`、`ORDER`、`REMOTE`、`HEALTH`、`ERROR` 分类。
- 生产环境必须启用 HTTPS，并妥善保护 `.env`、服务器日志和充值服务配置。

## 更新

一键部署：

```bash
git pull --ff-only
./ByBuy.sh
```

Docker Compose：

```bash
git pull --ff-only
docker compose up -d --build
```

## 开发检查

```bash
npm ci
npm test
npm run build
npm run dev
```
