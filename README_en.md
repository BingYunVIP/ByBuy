<p align="center">
  <img src="public/logo.png" alt="ByBuy" width="96" />
  <br />
  <a href="README.md">简体中文</a> | <b>English</b> | Site: <a href="https://buy.bingyun.vip">buy.bingyun.vip</a>
</p>

## Features

- **Three-step top-up**: check the subscription (paste your Session JSON and let the server verify it online) → validate the redemption code → submit. 3D Secure, when required, completes inline.
- **Order tracking**: look up progress with the original code (pending / processing / completed / incomplete); in-progress orders refresh automatically.
- **Subscription check**: personal Free accounts only — a short-lived credential is issued after the server confirms `personal + free` online.
- **Masked logs**: ChatGPT and Team card checks, queries, submissions, and redemptions are all logged, told apart by the `service` field. Cards appear only as a salted short fingerprint, emails are masked, IPs keep two segments, and passwords, tokens, and Sessions are never written.
- **Privacy**: the Session is verified in memory and forwarded to the top-up service only. It is never stored or logged, and the browser clears it right after submission.
- **Interface**: Chinese and English, light and dark themes, language follows the browser automatically, responsive on mobile.

## Routes

- `/chatgpt`: ChatGPT top-up and order lookup; the root path redirects here.
- `/team`: Team redemption by email invite or ready account. It needs `Team_Web`; without it the page shows as unavailable.
- `/chatgpt` and `/team` share one layout and blue-and-white theme, and the cards adapt to the browser's width and height.

## Requirements

- Linux (`ByBuy.sh` supports Linux only)
- Node.js `>= 24.5.0` — the script downloads the official build into `.runtime/` when unmet
- A confirmed, working HTTPS origin for the top-up service

## One-command deployment

```bash
git clone https://github.com/BingYunVIP/ByBuy.git
cd ByBuy
chmod +x ByBuy.sh
./ByBuy.sh
```

```text
1. Install / redeploy
2. Update to the latest version
3. Restart the service
4. Show service status
5. Show recent logs
0. Exit
```

Choose `1` for the first deployment. The script then: checks and installs missing base tools → detects the Node.js version (downloading the official v24 build with SHA-256 verification when below 24.5.0) → generates `.env` from `.env.example` with permissions `600` (prompting for the top-up service origin on first run) → installs dependencies, runs tests, builds for production → installs and starts `bybuy.service` (falling back to a background process without systemd) → prints the listening address once the health check passes.

Choose `2` to upgrade. It preserves `.env`, logs, and runtime data, then rebuilds and restarts.

## Configuration

Production configuration lives in `.env`, excluded from version control (permissions `600`):

| Variable | Purpose | Default |
| --- | --- | --- |
| `HOST` | Listen address | `0.0.0.0` |
| `PORT` | Listen port | `2254` |
| `ChatGPT_Web` | HTTPS origin of the top-up service; comma-separated primary / standby addresses supported | required |
| `PUBLIC_ORIGIN` | Public site origin, used for same-origin request validation | unset |
| `TRUST_PROXY` | Trusted proxy range | unset |
| `HTTP_PROXY` / `HTTPS_PROXY` | Optional; trusted proxy for outbound requests | unset |
| `NO_PROXY` | Optional; hosts that bypass the proxy | unset |
| `UPSTREAM_TIMEOUT_MS` | Remote request timeout in milliseconds | `25000` |
| `Team_Web` | HTTPS origin for the Team redemption proxy | unset (Team redemption shows as unavailable) |
| `TEAM_REDEEM_TIMEOUT_MS` | Team request timeout in milliseconds | `15000` |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` / `silent` | `info` |
| `LOG_SALT` | Salt for card fingerprints. Set it to keep one card's log lines linkable across restarts; empty means a new random salt on every start | empty |
| `SERVICE_DIAGNOSTICS` | Whether to log additional diagnostic metadata | `0` |
| `UPSTREAM_CONCURRENCY` | Per-process cap on concurrent remote requests | `8` |
| `UPSTREAM_QUEUE` | Maximum wait queue for the concurrency gate | `100` |
| `UPSTREAM_QUEUE_WAIT_MS` | Maximum queueing time in milliseconds | `8000` |

**`TRUST_PROXY` must be set.** Otherwise every visitor shares a single rate-limit bucket — one fast user triggers "too many requests" for everyone else. Use `loopback` for a local proxy.

If the server times out reaching ChatGPT while the shell already defines `HTTP_PROXY`, `HTTPS_PROXY`, or `NO_PROXY`, `ByBuy.sh` writes them into `.env` the first time it finds them unset. Proxy values never enter the install log.

## Local development

```bash
npm ci
cp .env.example .env      # fill in ChatGPT_Web
npm run dev               # Vite middleware + backend, single port
```

The Team page uses same-origin ByBuy endpoints for inventory and redemption; codes and account credentials stay in the request or page memory and are not persisted. Upstream URLs live only in `.env` and never reach the browser.

```bash
npm test                  # unit tests
npm run build             # type check + production build + bundle leak check
curl http://127.0.0.1:2254/api/health
```
