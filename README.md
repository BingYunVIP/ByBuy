<p align="center">
  <img src="public/logo.png" alt="ByBuy" width="96" />
  <br />
  <b>简体中文</b> | <a href="README_en.md">English</a> | 站点：<a href="https://buy.bingyun.vip">buy.bingyun.vip</a>
</p>

## 项目功能

ByBuy 是一个自助服务网站，提供两项功能：

- **ChatGPT 充值**（`/chatgpt`）：检查订阅、验证卡密、提交充值，并可用卡密查询订单进度。
- **Team 兑换**（`/team`）：用卡密通过邮箱邀请加入 Team，或领取现成账号。

支持中英文与深浅主题，移动端自适应。Session、账号凭据只在请求或页面内存中处理，不落库；日志中的卡密、邮箱、IP 均已脱敏。

## 环境要求

- Linux
- Node.js `>= 24.5.0`（不满足时脚本自动下载到 `.runtime/`）
- 可用的充值服务 HTTPS Origin

## 一键部署

```bash
git clone https://github.com/BingYunVIP/ByBuy.git
cd ByBuy
chmod +x ByBuy.sh
./ByBuy.sh
```

首次部署选 `1`，脚本会生成 `.env`、安装依赖、构建并启动 `bybuy.service`。后续升级选 `2`，会保留 `.env` 与运行数据。

```text
1. 安装 / 重新部署
2. 更新到最新版本
3. 重启服务
4. 查看服务状态
5. 查看最近日志
0. 退出
```

## 配置

配置写在 `.env`（不纳入版本控制，模板见 `.env.example`）：

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `HOST` / `PORT` | 监听地址与端口 | `0.0.0.0` / `2254` |
| `ChatGPT_Web` | 充值服务 HTTPS Origin，逗号分隔可写主备 | 必填 |
| `Team_Web` | Team 兑换接口的 HTTPS Origin，需以 `/` 结尾 | 未设置（Team 页显示「暂未开放」） |
| `PUBLIC_ORIGIN` | 公网站点 Origin，用于同源校验 | 未设置 |
| `TRUST_PROXY` | 可信代理范围，本机反代填 `loopback` | 未设置 |
| `UPSTREAM_TIMEOUT_MS` | 充值请求超时（毫秒） | `25000` |
| `TEAM_REDEEM_TIMEOUT_MS` | Team 请求超时（毫秒），需小于 `30000` | `15000` |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` / `silent` | `info` |
| `LOG_SALT` | 卡密指纹的盐，固定后重启前后日志仍可关联 | 留空（随机） |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | 可选，外网代理 | 未设置 |

**`TRUST_PROXY` 必须设置**，否则所有访客共用一个限流桶。

## 本地开发

```bash
npm ci
cp .env.example .env      # 填写 ChatGPT_Web
npm run dev               # 单端口，同时启动前端与后端
npm test                  # 单元测试
npm run build             # 类型检查 + 生产构建
```
