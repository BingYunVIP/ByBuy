<p align="center">
  <img src="public/logo.png" alt="ByBuy" width="96" />
  <br />
  <a href="README.md">简体中文</a> | <b>English</b> | Site: <a href="https://buy.bingyun.vip">buy.bingyun.vip</a>
</p>

## Features

ByBuy is a self-service website with two functions:

- **ChatGPT top-up** (`/chatgpt`): check the subscription, validate a redemption code, submit the top-up, and look up order progress with the same code.
- **Team redemption** (`/team`): redeem a code to join a Team by email invite, or claim a ready account.

It supports Chinese and English, light and dark themes, and mobile layouts. Sessions and account credentials are handled in request or page memory only and never stored; codes, emails, and IPs are masked in logs.

## Requirements

- Linux
- Node.js `>= 24.5.0` (downloaded into `.runtime/` by the script when unmet)
- A working HTTPS origin for the top-up service

## One-command deployment

```bash
git clone https://github.com/BingYunVIP/ByBuy.git
cd ByBuy
chmod +x ByBuy.sh
./ByBuy.sh
```

Choose `1` for the first deployment: the script creates `.env`, installs dependencies, builds, and starts `bybuy.service`. Choose `2` to upgrade; `.env` and runtime data are kept.

```text
1. Install / redeploy
2. Update to the latest version
3. Restart the service
4. Show service status
5. Show recent logs
0. Exit
```

## Configuration

Settings live in `.env` (not under version control; template in `.env.example`):

| Variable | Purpose | Default |
| --- | --- | --- |
| `HOST` / `PORT` | Listen address and port | `0.0.0.0` / `2254` |
| `ChatGPT_Web` | HTTPS origin of the top-up service; comma-separate for primary / standby | required |
| `Team_Web` | HTTPS origin of the Team redemption API; must end with `/` | unset (Team page shows as unavailable) |
| `PUBLIC_ORIGIN` | Public site origin, used for same-origin checks | unset |
| `TRUST_PROXY` | Trusted proxy range; use `loopback` behind a local proxy | unset |
| `UPSTREAM_TIMEOUT_MS` | Top-up request timeout (ms) | `25000` |
| `TEAM_REDEEM_TIMEOUT_MS` | Team request timeout (ms); keep under `30000` | `15000` |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` / `silent` | `info` |
| `LOG_SALT` | Salt for card fingerprints; fix it to link log lines across restarts | empty (random) |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | Optional outbound proxy | unset |

**`TRUST_PROXY` must be set.** Otherwise every visitor shares one rate-limit bucket.

## Local development

```bash
npm ci
cp .env.example .env      # fill in ChatGPT_Web
npm run dev               # frontend and backend on a single port
npm test                  # unit tests
npm run build             # type check + production build
```
