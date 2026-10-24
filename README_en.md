# ByBuy

[简体中文](README.md) | **English**

ByBuy is a self-service **ChatGPT top-up** application with a bundled frontend and backend:
users submit a redeem code and their ChatGPT Session in the browser, and the server handles
subscription verification, redeem-code validation, order submission, and progress tracking.

**Production site: <https://buy.bingyun.vip>**

The frontend is built with React 19 + Vite and the backend runs on Express (Node.js 24+).
Both share a single port: one process serves the pages and the API.

## Features

**Top-up flow (three steps)**

1. **Check subscription** — paste or import the ChatGPT Session JSON. The server verifies the
   account type and plan online and accepts personal Free accounts only (Plus / Team / Pro
   receive an explicit notice).
2. **Validate redeem code** — checks whether the code is valid and usable, then opens the
   submission page. Redeem-code plans are shown under three names only: Go, Plus, and Pro
   (every Pro tier is displayed as Pro). Renewal cards and Codex credit cards are out of scope:
   validation and order lookup explicitly return "this type of redeem code is not supported on
   this site".
3. **Complete submission** — submits the top-up request. If 3D Secure verification is required,
   it completes inline without redirecting to an external checkout. Verification progress
   (challenge shown / started / succeeded / failed) is reported back to the top-up service
   automatically, carrying only the redeem code and the event type — never the Session.

**Order lookup**

- Look up order status with the original redeem code: pending / processing / completed / incomplete.
- The result page shows the top-up account, order suffix, redeem code (masked in the middle), and
  an "order submitted → processing started → top-up completed" timeline.
- In-progress orders poll and refresh automatically, with no manual reloading.

**Pages and UX**

- Plan information: Plus, Pro 5x, Pro 10x, Pro 25x.
- Top navigation: order lookup, global price comparison, AI relay station, Bingyun store
  (redeem-code purchase), after-sales group, contact email.
- Top-up notices are grouped into three tiers: "confirm your account first", "do not submit",
  and "recommendations and guarantees".
- Chinese / English and dark / light theme switching (light by default), responsive on mobile.

**Service availability**

- A persistent "system status" indicator in the top bar. The backend probes the top-up service on
  a schedule and exposes only availability and latency to the frontend.
- When the service is unavailable, the top-up and order cards are disabled as a whole with a
  re-check entry point, so users are not left filling in a form only to be told "temporarily
  unreachable".

**Security and privacy**

- HTTPS end to end. In production the server sets CSP, `X-Frame-Options: DENY`, and other
  security response headers.
- The Session JSON is verified in memory and forwarded to the top-up service only. It is never
  written to a database, file, or application log, and the frontend clears the input immediately
  after submission.
- Logs record stage, path, status, duration, client IP, and error codes only — never request
  bodies, redeem codes, or tokens.

**Subscription verification**

- After parsing the Session in the browser, only the access token and the account identifier are
  sent to the same-origin `/api/subscriptions/check`.
- The server reads the current plan through ChatGPT's read-only account / workspace check and
  requires the online result to exactly match the account identifier in the Session.
- Network failures, timeouts, and ChatGPT `5xx` responses are retried once within the overall
  timeout. `401`, `403`, `429`, and unrecognizable responses are never retried blindly.
- A short-lived verification credential is issued only after an online confirmation of
  `personal + free`. A local JWT plan claim, a missing account structure, or conflicting records
  can never unlock redeem-code validation.

## Requirements

- Linux (`ByBuy.sh` supports Linux only)
- Node.js `>= 24.5.0` — the script detects this and, if unmet, downloads the official Node.js
  build into the project-private `.runtime/` directory
- An HTTPS reverse proxy pointing at the local port (Caddy or Nginx) for domain binding and
  certificates
- A confirmed, working HTTPS origin for the top-up service

## One-command deployment

```bash
git clone https://github.com/BingYunVIP/ByBuy.git
cd ByBuy
chmod +x ByBuy.sh
./ByBuy.sh
```

The script presents a management menu:

```text
1. Install / redeploy
2. Update to the latest version
3. Restart the service
4. Show service status
5. Show recent logs
0. Exit
```

Choose `1` for the first deployment. `ByBuy.sh` then:

1. Checks for and installs missing base tools (curl / tar / xz / ss / ip), using the system
   package manager when necessary.
2. Detects the Node.js version. Below 24.5.0, it downloads the official v24 binary
   (SHA-256 verified) into `.runtime/node`.
3. Generates `.env` from `.env.example` with permissions `600`. On first run it prompts
   interactively for the top-up service HTTPS origin.
4. Stops the previous process and checks the listening port. If the port is taken, it selects a
   free port automatically and writes it back to `.env`.
5. Installs dependencies, runs unit tests, and produces the production build.
6. Installs and starts `bybuy.service` by default, falling back to a background process when
   systemd is unavailable.
7. After the health check passes, prints the actual listening address and the log commands.

## Configuration

Production configuration lives in `.env`, which is excluded from version control
(permissions `600`):

| Variable | Purpose | Default |
| --- | --- | --- |
| `HOST` | Listen address | `0.0.0.0` |
| `PORT` | Listen port | `2254` |
| `UPSTREAM_ORIGIN` | HTTPS origin of the top-up service; comma-separated primary / standby addresses are supported | required |
| `PUBLIC_ORIGIN` | Public site origin, used for same-origin request validation | unset |
| `TRUST_PROXY` | Trusted reverse-proxy range | unset |
| `HTTP_PROXY` / `HTTPS_PROXY` | Optional; trusted proxy used by Node.js for outbound requests | unset |
| `NO_PROXY` | Optional; hosts that bypass the proxy | unset |
| `UPSTREAM_TIMEOUT_MS` | Remote request timeout in milliseconds | `25000` |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` / `silent` | `info` |
| `SERVICE_DIAGNOSTICS` | Whether to log additional diagnostic metadata | `0` |
| `UPSTREAM_CONCURRENCY` | Per-process cap on concurrent remote requests | `8` |
| `UPSTREAM_QUEUE` | Maximum wait queue for the concurrency gate | `100` |
| `UPSTREAM_QUEUE_WAIT_MS` | Maximum queueing time in milliseconds | `8000` |

**`TRUST_PROXY` must be set.** Without it behind a reverse proxy, `req.ip` is always the proxy
address, so every user shares a single rate-limit bucket — one fast user triggers "too many
requests" for everyone else. For a local proxy, set `loopback`.

If the server times out connecting to ChatGPT directly while the current shell already defines
`HTTP_PROXY`, `HTTPS_PROXY`, or `NO_PROXY`, `ByBuy.sh` writes them into `.env` safely the first
time it finds them unset. Proxy values never enter the install log and `.env` keeps permissions
`600`. Use only proxies you trust and are authorized to use; to change a proxy, edit `.env` and
restart the service.

## HTTPS reverse proxy

The repository ships [`deploy/Caddyfile`](deploy/Caddyfile), which forwards `buy.bingyun.vip` to
`127.0.0.1:2254` by default. If `ByBuy.sh` selected a different port, update the proxy target
accordingly.

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

Apply the configuration:

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

## Updating

Enter the project directory and open the menu:

```bash
cd /root/ByBuy
./ByBuy.sh
```

Choose `2. Update to the latest version`. The script will:

1. Fetch and download the latest code from GitHub.
2. Preserve `.env`, logs, and runtime data.
3. Stop rather than overwrite when local file modifications are detected. If only `ByBuy.sh` was
   modified, it backs it up first and asks whether to replace it.
4. Run tests and the production build.
5. Keep the existing port and restart the service.
6. Run the health check and report the result.

To switch from an older script to the management menu for the first time, run this once in the
project directory:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/BingYunVIP/ByBuy/main/ByBuy.sh)
```

Then choose `2`. After this one-time switch, `./ByBuy.sh` is all you need.

## Operations

Open the management menu:

```bash
cd /root/ByBuy
./ByBuy.sh
```

The menu covers restart, status checks, and log viewing. In background-process mode, logs are at
`logs/runtime.log` and the PID at `run/bybuy.pid`.

Install logs are written to `logs/install-*.log` (one per run). Application logs are categorized
as `LIFECYCLE`, `HTTP`, `SECURITY`, `SUBSCRIPTION`, `ORDER`, `REMOTE`, `HEALTH`, and `ERROR`.
The `ORDER` category covers order submission and secure-verification progress reporting
(`VERIFICATION_EVENT`); it records event types only, never redeem codes.

If a subscription check fails, start with the most recent redacted results:

```bash
journalctl -u bybuy -n 100 -o cat | grep '"category":"SUBSCRIPTION"'
```

`SUBSCRIPTION` logs contain only whether the credential was accepted, the check result, whether a
verification credential was issued, and error codes — no account IDs, email addresses, access
tokens, or Session JSON.

## Local development

```bash
npm ci
cp .env.example .env      # fill in UPSTREAM_ORIGIN
npm run dev               # Vite middleware + backend, single port
```

Checks:

```bash
npm test                  # unit tests
npm run build             # type check + production build + bundle leak check
curl http://127.0.0.1:2254/api/health
```
