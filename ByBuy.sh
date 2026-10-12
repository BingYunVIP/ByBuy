#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT/logs"
RUN_DIR="$ROOT/run"
RUNTIME_DIR="$ROOT/.runtime"
SERVICE_NAME="bybuy"
MIN_NODE_VERSION="24.5.0"
INSTALL_LOG="$LOG_DIR/install-$(date +%Y%m%d-%H%M%S).log"
PKG_UPDATED=0

mkdir -p "$LOG_DIR" "$RUN_DIR"
touch "$INSTALL_LOG"
exec > >(tee -a "$INSTALL_LOG") 2>&1

if [[ -t 1 ]]; then
  C_BLUE=$'\033[34m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_RESET=$'\033[0m'
else
  C_BLUE=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_RESET=''
fi

log() {
  local level="$1" category="$2"; shift 2
  local color="$C_BLUE"
  [[ "$level" == "OK" ]] && color="$C_GREEN"
  [[ "$level" == "WARN" ]] && color="$C_YELLOW"
  [[ "$level" == "ERROR" ]] && color="$C_RED"
  printf '%s[%s] [%s] [%s]%s %s\n' "$color" "$(date '+%Y-%m-%d %H:%M:%S')" "$level" "$category" "$C_RESET" "$*"
}

die() { log ERROR SYSTEM "$*"; exit 1; }

on_error() {
  local line="$1" code="$2"
  log ERROR SYSTEM "脚本在第 ${line} 行失败，退出码 ${code}。安装日志：$INSTALL_LOG"
}
trap 'on_error "$LINENO" "$?"' ERR

as_root() {
  if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    die "需要管理员权限执行：$*. 请安装 sudo 或使用 root 运行。"
  fi
}

ask_yes_no() {
  local prompt="$1" default="${2:-Y}" answer
  if [[ ! -t 0 ]]; then
    [[ "$default" == "Y" ]]
    return
  fi
  if [[ "$default" == "Y" ]]; then
    read -r -p "$prompt [Y/n] " answer || true
    answer="${answer:-Y}"
  else
    read -r -p "$prompt [y/N] " answer || true
    answer="${answer:-N}"
  fi
  [[ "$answer" =~ ^[Yy]$ ]]
}

detect_package_manager() {
  if command -v apt-get >/dev/null 2>&1; then PKG_MANAGER=apt
  elif command -v dnf >/dev/null 2>&1; then PKG_MANAGER=dnf
  elif command -v yum >/dev/null 2>&1; then PKG_MANAGER=yum
  elif command -v pacman >/dev/null 2>&1; then PKG_MANAGER=pacman
  elif command -v zypper >/dev/null 2>&1; then PKG_MANAGER=zypper
  else PKG_MANAGER=none
  fi
}

install_base_tools() {
  local missing=() command
  for command in curl tar xz sha256sum ss ip awk sed install; do
    command -v "$command" >/dev/null 2>&1 || missing+=("$command")
  done
  if [[ ${#missing[@]} -eq 0 ]]; then
    log OK DEPENDENCY "基础工具齐全。"
    return
  fi

  detect_package_manager
  [[ "$PKG_MANAGER" != "none" ]] || die "缺少工具：${missing[*]}，且未识别到受支持的包管理器。"
  log INFO DEPENDENCY "缺少工具：${missing[*]}，使用 $PKG_MANAGER 自动安装。"
  case "$PKG_MANAGER" in
    apt)
      if [[ $PKG_UPDATED -eq 0 ]]; then as_root apt-get update; PKG_UPDATED=1; fi
      as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y curl ca-certificates xz-utils tar iproute2 coreutils
      ;;
    dnf) as_root dnf install -y curl ca-certificates xz tar iproute coreutils ;;
    yum) as_root yum install -y curl ca-certificates xz tar iproute coreutils ;;
    pacman) as_root pacman -Sy --noconfirm curl ca-certificates xz tar iproute2 coreutils ;;
    zypper) as_root zypper --non-interactive install curl ca-certificates xz tar iproute2 coreutils ;;
  esac
  for command in curl tar xz sha256sum ss ip install; do command -v "$command" >/dev/null 2>&1 || die "自动安装后仍缺少 $command。"; done
  log OK DEPENDENCY "基础工具安装完成。"
}

version_ge() {
  [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" == "$2" ]]
}

install_project_node() {
  local machine node_arch index version archive url temp expected actual
  machine="$(uname -m)"
  case "$machine" in
    x86_64|amd64) node_arch=x64 ;;
    aarch64|arm64) node_arch=arm64 ;;
    *) die "Node.js 官方 Linux 二进制暂不支持当前架构：$machine" ;;
  esac
  if command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; then
    die "检测到 musl/Alpine。请通过系统包管理器安装 Node.js 24.5+ 后重新运行。"
  fi

  log INFO DEPENDENCY "查询 Node.js 官方 v24 发行版本。"
  index="$(curl -fsSL --retry 3 https://nodejs.org/dist/index.tab)"
  version="$(printf '%s\n' "$index" | awk -F '\t' '$1 ~ /^v24\./ { print $1; exit }')"
  [[ -n "$version" ]] || die "无法从 nodejs.org 获取 Node.js v24 版本。"
  version_ge "${version#v}" "$MIN_NODE_VERSION" || die "官方可用版本 $version 低于最低要求 $MIN_NODE_VERSION。"

  archive="node-${version}-linux-${node_arch}.tar.xz"
  url="https://nodejs.org/dist/${version}"
  temp="$(mktemp -d)"
  curl -fsSL --retry 3 "$url/$archive" -o "$temp/$archive"
  curl -fsSL --retry 3 "$url/SHASUMS256.txt" -o "$temp/SHASUMS256.txt"
  expected="$(awk -v file="$archive" '$2 == file { print $1 }' "$temp/SHASUMS256.txt")"
  actual="$(sha256sum "$temp/$archive" | awk '{print $1}')"
  [[ -n "$expected" && "$expected" == "$actual" ]] || die "Node.js 安装包 SHA-256 校验失败。"

  mkdir -p "$RUNTIME_DIR"
  find "$RUNTIME_DIR" -mindepth 1 -depth -delete 2>/dev/null || true
  tar -xJf "$temp/$archive" -C "$RUNTIME_DIR"
  mv "$RUNTIME_DIR/node-${version}-linux-${node_arch}" "$RUNTIME_DIR/node"
  NODE_BIN="$RUNTIME_DIR/node/bin/node"
  NPM_BIN="$RUNTIME_DIR/node/bin/npm"
  find "$temp" -depth -delete
  log OK DEPENDENCY "已安装项目私有 Node.js $version。"
}

select_node() {
  local current=''
  if command -v node >/dev/null 2>&1; then current="$(node -p 'process.versions.node' 2>/dev/null || true)"; fi
  if [[ -n "$current" ]] && version_ge "$current" "$MIN_NODE_VERSION" && command -v npm >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
    NPM_BIN="$(command -v npm)"
    log OK DEPENDENCY "使用系统 Node.js v$current：$NODE_BIN"
  else
    [[ -n "$current" ]] && log WARN DEPENDENCY "系统 Node.js v$current 不符合要求（>= $MIN_NODE_VERSION）。"
    install_project_node
  fi
  export PATH="$(dirname "$NODE_BIN"):$PATH"
  "$NODE_BIN" -e 'const [a,b,c]=process.versions.node.split(".").map(Number); if(a<24 || (a===24 && (b<5 || (b===5 && c<0)))) process.exit(1)'
}

get_env() {
  local key="$1"
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$ROOT/.env" 2>/dev/null || true
}

set_env() {
  local key="$1" value="$2" temp
  temp="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { done=0 }
    $0 ~ "^" key "=" { print key "=" value; done=1; next }
    { print }
    END { if (!done) print key "=" value }
  ' "$ROOT/.env" > "$temp"
  chmod 600 "$temp"
  mv "$temp" "$ROOT/.env"
}

prepare_env() {
  if [[ ! -f "$ROOT/.env" ]]; then
    cp "$ROOT/.env.example" "$ROOT/.env"
    chmod 600 "$ROOT/.env"
    log INFO CONFIG "已由 .env.example 创建 .env。"
  fi
  local origin
  origin="$(get_env UPSTREAM_ORIGIN)"
  if [[ -z "$origin" || "$origin" == *example* ]]; then
    if [[ -t 0 ]]; then
      read -r -p "请输入充值服务 HTTPS origin（多个地址用逗号分隔）: " origin
      [[ "$origin" == https://* ]] || die "UPSTREAM_ORIGIN 必须使用 HTTPS。"
      set_env UPSTREAM_ORIGIN "$origin"
    else
      die ".env 中 UPSTREAM_ORIGIN 未配置，非交互模式无法继续。"
    fi
  fi
  set_env HOST "0.0.0.0"
  log OK CONFIG ".env 检查完成，敏感值不会打印到日志。"
}

port_in_use() {
  local port="$1"
  ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq "(^|[.:])${port}$"
}

random_free_port() {
  local port attempt
  for attempt in $(seq 1 200); do
    if command -v shuf >/dev/null 2>&1; then port="$(shuf -i 20000-60000 -n 1)"; else port=$((20000 + RANDOM % 40001)); fi
    if ! port_in_use "$port"; then printf '%s\n' "$port"; return; fi
  done
  return 1
}

choose_port() {
  PORT="$(get_env PORT)"
  [[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT >= 1 && PORT <= 65535 )) || PORT=2254
  if port_in_use "$PORT"; then
    local previous="$PORT"
    PORT="$(random_free_port)" || die "无法找到空闲端口。"
    log WARN PORT "端口 $previous 已占用，自动选择空闲端口 $PORT。"
  else
    log OK PORT "端口 $PORT 可用。"
  fi
  set_env PORT "$PORT"
}

build_project() {
  log INFO BUILD "安装生产及构建依赖。"
  "$NPM_BIN" ci --no-audit --no-fund
  log INFO TEST "运行单元测试。"
  "$NPM_BIN" test
  log INFO BUILD "生成生产构建。"
  "$NPM_BIN" run build
  log OK BUILD "依赖、测试和构建均已完成。"
}

systemd_available() {
  command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]
}

install_systemd_service() {
  systemd_available || return 1
  local run_user run_group unit temp
  run_user="${SUDO_USER:-$(id -un)}"
  [[ -n "$run_user" ]] || run_user=root
  run_group="$(id -gn "$run_user" 2>/dev/null || printf '%s' "$run_user")"
  [[ "$run_user" != root ]] || log WARN SERVICE "当前项目位于 root 环境，systemd 服务将以 root 运行；生产部署建议使用独立普通用户。"
  unit="/etc/systemd/system/${SERVICE_NAME}.service"
  temp="$(mktemp)"
  cat > "$temp" <<EOF
[Unit]
Description=AITop-Up web service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$run_user
Group=$run_group
WorkingDirectory=$ROOT
Environment=NODE_ENV=production
ExecStart="$NODE_BIN" --env-file-if-exists=.env --use-env-proxy "$ROOT/server/index.mjs"
Restart=on-failure
RestartSec=3
TimeoutStopSec=15
KillSignal=SIGTERM
UMask=0027
NoNewPrivileges=true
PrivateTmp=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
StandardOutput=journal
StandardError=journal
SyslogIdentifier=bybuy

[Install]
WantedBy=multi-user.target
EOF
  as_root install -m 0644 "$temp" "$unit"
  find "$temp" -delete
  as_root systemctl daemon-reload
  as_root systemctl enable --now "$SERVICE_NAME.service"
  log OK SERVICE "systemd 服务已启用并启动：$SERVICE_NAME.service"
  LOG_COMMAND="journalctl -u $SERVICE_NAME -f -o cat"
}

start_background() {
  local old_pid=''
  [[ -f "$RUN_DIR/bybuy.pid" ]] && old_pid="$(cat "$RUN_DIR/bybuy.pid" 2>/dev/null || true)"
  if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then kill "$old_pid" || true; fi
  nohup "$NODE_BIN" --env-file-if-exists=.env --use-env-proxy "$ROOT/server/index.mjs" >> "$LOG_DIR/runtime.log" 2>&1 &
  printf '%s\n' "$!" > "$RUN_DIR/bybuy.pid"
  LOG_COMMAND="tail -f $LOG_DIR/runtime.log"
  log OK SERVICE "已使用后台进程启动，PID=$!。"
}

wait_for_health() {
  local attempt
  for attempt in $(seq 1 60); do
    if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
      log OK HEALTH "健康检查通过。"
      return
    fi
    sleep 0.5
  done
  die "服务启动后健康检查未通过。查看日志：$LOG_COMMAND"
}

print_addresses() {
  local found=0 ip
  log INFO NETWORK "可访问地址（防火墙策略可能影响远程访问）："
  printf '  http://127.0.0.1:%s\n' "$PORT"
  while read -r ip; do
    [[ -n "$ip" && "$ip" != 127.* ]] || continue
    printf '  http://%s:%s\n' "$ip" "$PORT"
    found=1
  done < <(ip -o -4 addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | sort -u)
  [[ $found -eq 1 ]] || log WARN NETWORK "未检测到全局 IPv4 地址，仅打印本机地址。"
  log INFO NETWORK "域名绑定与 HTTPS 证书不由本脚本处理；请将反向代理指向 127.0.0.1:$PORT。"
}

main() {
  [[ "$(uname -s)" == Linux ]] || die "ByBuy.sh 目前只支持 Linux。"
  cd "$ROOT"
  log INFO SYSTEM "项目目录：$ROOT"
  install_base_tools
  select_node
  prepare_env

  local enable_service=0
  case "${BYBUY_ENABLE_SERVICE:-ask}" in
    1|Y|y|yes|YES) enable_service=1; log INFO SERVICE "已通过 BYBUY_ENABLE_SERVICE 启用 systemd。" ;;
    0|N|n|no|NO) enable_service=0; log INFO SERVICE "已通过 BYBUY_ENABLE_SERVICE 禁用 systemd。" ;;
    ask) if ask_yes_no "是否启用 systemd 系统服务（不使用 Docker，推荐）？" Y; then enable_service=1; fi ;;
    *) die "BYBUY_ENABLE_SERVICE 只能是 0、1 或 ask。" ;;
  esac
  if [[ $enable_service -eq 1 ]] && systemd_available && systemctl list-unit-files "$SERVICE_NAME.service" >/dev/null 2>&1; then
    as_root systemctl stop "$SERVICE_NAME.service" 2>/dev/null || true
    log INFO SERVICE "已停止现有 systemd 服务以便更新。"
  fi

  choose_port
  build_project

  if [[ $enable_service -eq 1 ]]; then
    if ! install_systemd_service; then
      log WARN SERVICE "当前系统未以 systemd 运行，自动回退为后台进程。"
      start_background
    fi
  else
    start_background
  fi

  wait_for_health
  print_addresses
  log INFO LOG "安装日志：$INSTALL_LOG"
  log INFO LOG "应用日志分类：LIFECYCLE / HTTP / SECURITY / ORDER / REMOTE / HEALTH / ERROR"
  log INFO LOG "实时查看：$LOG_COMMAND"
  log OK SYSTEM "AITop-Up 部署完成。"
}

main "$@"
