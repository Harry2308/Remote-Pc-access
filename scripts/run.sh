#!/usr/bin/env bash
# run.sh — Single entry point for Remote PC Access.
# Works for first-time setup AND day-to-day updates/restarts.
# Safe to re-run at any time (fully idempotent).
#
# Usage:
#   bash scripts/run.sh              # deploy + start everything
#   bash scripts/run.sh --ollama     # also install Ollama on the PC (first time)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.."; pwd)"
PC_HOST="192.168.0.137"
PC_USER="unger"
PC_PATH="D:/remote-pc-access"
PC_PATH_WIN="D:\\remote-pc-access"
TASK_NAME="RemotePCAgent"
RELAY_ENV="$ROOT/relay-server/.env"
LOGDIR="$ROOT/.logs"

INSTALL_OLLAMA=false
for arg in "$@"; do [[ "$arg" == "--ollama" ]] && INSTALL_OLLAMA=true; done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[run]${NC} $*"; }
success() { echo -e "${GREEN}[run]${NC} $*"; }
warn()    { echo -e "${YELLOW}[run]${NC} $*"; }
error()   { echo -e "${RED}[run]${NC}  $*"; }
die()     { error "$*"; exit 1; }

# ── Step 1: Ensure relay-server/.env exists and is configured ────────────────
if [[ ! -f "$RELAY_ENV" ]]; then
  info "relay-server/.env not found — creating from template..."
  cat > "$RELAY_ENV" <<'EOF'
JWT_SECRET=
AGENT_SECRET=
ADMIN_PASSWORD=
ADMIN_USERNAME=admin
PORT=3001
EOF
fi

JWT_SECRET=$(grep    '^JWT_SECRET='     "$RELAY_ENV" | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
AGENT_SECRET=$(grep  '^AGENT_SECRET='   "$RELAY_ENV" | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
ADMIN_PASS=$(grep    '^ADMIN_PASSWORD=' "$RELAY_ENV" | cut -d= -f2- | tr -d '"' | tr -d "'" || true)

if [[ -z "$JWT_SECRET" ]]; then
  JWT_SECRET=$(openssl rand -hex 32)
  sed -i "s/^JWT_SECRET=.*/JWT_SECRET=${JWT_SECRET}/" "$RELAY_ENV"
  info "Generated JWT_SECRET"
fi

if [[ -z "$AGENT_SECRET" ]]; then
  AGENT_SECRET=$(openssl rand -hex 32)
  sed -i "s/^AGENT_SECRET=.*/AGENT_SECRET=${AGENT_SECRET}/" "$RELAY_ENV"
  info "Generated AGENT_SECRET"
fi

if [[ -z "$ADMIN_PASS" ]]; then
  echo ""
  read -rp "$(echo -e "${CYAN}[run]${NC} Choose an ADMIN_PASSWORD for the web login: ")" ADMIN_PASS
  sed -i "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=${ADMIN_PASS}/" "$RELAY_ENV"
fi

WIN_PASSWORD=$(grep '^WIN_PASSWORD=' "$RELAY_ENV" | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
if [[ -z "$WIN_PASSWORD" ]]; then
  echo ""
  read -rsp "$(echo -e "${CYAN}[run]${NC} Enter Windows password for ${PC_USER} (saved to .env, never re-asked): ")" WIN_PASSWORD
  echo ""
  sed -i "s/^WIN_PASSWORD=.*/WIN_PASSWORD=${WIN_PASSWORD}/" "$RELAY_ENV"
  info "Windows password saved to relay-server/.env"
fi

# Re-read final values to be sure
AGENT_SECRET=$(grep '^AGENT_SECRET=' "$RELAY_ENV" | cut -d= -f2- | tr -d '"' | tr -d "'")
WIN_PASSWORD=$(grep '^WIN_PASSWORD=' "$RELAY_ENV" | cut -d= -f2- | tr -d '"' | tr -d "'")
success "Secrets ready"

# ── Step 2: Ensure wol-agent/.env is configured ───────────────────────────────
WOL_ENV="$ROOT/wol-agent/.env"
if [[ ! -f "$WOL_ENV" ]]; then
  info "Writing wol-agent/.env..."
  cat > "$WOL_ENV" <<EOF
AGENT_SECRET=${AGENT_SECRET}
TARGET_MAC=b4:2e:99:4c:35:8f
BROADCAST_IP=192.168.0.255
PORT=3003
EOF
  success "wol-agent/.env written"
else
  sed -i "s/^AGENT_SECRET=.*/AGENT_SECRET=${AGENT_SECRET}/" "$WOL_ENV"
fi

# ── Step 3: Auto-detect laptop LAN IP ────────────────────────────────────────
LAPTOP_IP=$(ip route get "${PC_HOST}" | grep -oP 'src \K[\d.]+' || true)
if [[ -z "$LAPTOP_IP" ]]; then
  error "Could not detect laptop LAN IP automatically."
  read -rp "$(echo -e "${CYAN}[run]${NC} Enter your laptop's LAN IP manually: ")" LAPTOP_IP
fi
RELAY_URL="ws://${LAPTOP_IP}:3001"
info "Relay URL: ${RELAY_URL}"

# ── Hash helpers ─────────────────────────────────────────────────────────────
# hash_local <path...>  — sha256 of all files under given paths, 16-char prefix
hash_local() {
  find "$@" -type f 2>/dev/null | sort | xargs sha256sum 2>/dev/null | sha256sum | cut -c1-16
}

# pc_read_hash <name>   — read a stored hash from PC, returns "none" if absent
pc_read_hash() {
  $SSH "${PC_USER}@${PC_HOST}" \
    "powershell -Command \"if (Test-Path 'D:\\remote-pc-access\\.hashes\\$1') { (Get-Content 'D:\\remote-pc-access\\.hashes\\$1' | Select-Object -First 1).Trim() } else { 'none' }\"" \
    2>/dev/null | tr -d '\0\r\n ' || echo "none"
}

# pc_write_hash <name> <value>  — write/overwrite a hash file on the PC
pc_write_hash() {
  $SSH "${PC_USER}@${PC_HOST}" \
    "powershell -Command \"New-Item -Force -ItemType Directory -Path 'D:\\remote-pc-access\\.hashes' | Out-Null; Set-Content -Path 'D:\\remote-pc-access\\.hashes\\$1' -Value '$2'\"" \
    2>/dev/null || true
}

# ── Step 4: Clean up any stale SSH control sockets ───────────────────────────
# Stale sockets from a previous crashed run cause silent SSH failures
rm -f /tmp/run-ssh-* 2>/dev/null || true

SOCKET="/tmp/run-ssh-$$"
SSH="ssh -o ControlMaster=auto -o ControlPath=${SOCKET} -o ControlPersist=120 -o ConnectTimeout=10 -o StrictHostKeyChecking=no"
SCP="scp -o ControlMaster=auto -o ControlPath=${SOCKET} -o ControlPersist=120 -o ConnectTimeout=10 -o StrictHostKeyChecking=no"

cleanup_ssh() { ssh -O exit -o ControlPath="${SOCKET}" "${PC_USER}@${PC_HOST}" 2>/dev/null || true; }
trap cleanup_ssh EXIT

# ── Step 5: Verify PC is reachable before attempting SSH ─────────────────────
info "Checking PC is reachable at ${PC_HOST}..."
if ! ping -c 1 -W 3 "${PC_HOST}" &>/dev/null; then
  die "Cannot reach PC at ${PC_HOST}. Is it on and connected to the network?"
fi
success "PC is reachable"

info "Connecting to ${PC_USER}@${PC_HOST} (enter Windows password once)..."
if ! $SSH "${PC_USER}@${PC_HOST}" "echo connected" > /dev/null 2>&1; then
  die "SSH connection failed. Check your Windows password and that OpenSSH is running on the PC."
fi
success "SSH connection established"

# ── SSH key setup (one-time, idempotent — eliminates password prompt) ─────────
if [[ -f ~/.ssh/id_ed25519.pub ]]; then
  KEY_PRESENT=$($SSH "${PC_USER}@${PC_HOST}" \
    "powershell -Command \"\$af='C:\ProgramData\ssh\administrators_authorized_keys'; \$uf='\$HOME\.ssh\authorized_keys'; if (((Test-Path \$af) -and (Select-String -Quiet -SimpleMatch 'id_ed25519' \$af)) -or ((Test-Path \$uf) -and (Select-String -Quiet -SimpleMatch 'id_ed25519' \$uf))) { 'yes' } else { 'no' }\"" \
    2>/dev/null | tr -d '\0\r\n' || echo "no")
  if [[ "$KEY_PRESENT" != "yes" ]]; then
    info "Installing SSH public key on PC (last time password is needed)..."
    # Write to user authorized_keys
    $SCP ~/.ssh/id_ed25519.pub "${PC_USER}@${PC_HOST}:${PC_PATH}/tmp_sshkey" 2>/dev/null && \
    $SSH "${PC_USER}@${PC_HOST}" \
      "powershell -Command \"\$k=Get-Content 'D:\\remote-pc-access\\tmp_sshkey'; New-Item -Force -ItemType Directory '\$HOME\.ssh'|Out-Null; Add-Content '\$HOME\.ssh\authorized_keys' \$k\"" \
      2>/dev/null || true
    # Also write to admin authorized_keys (Windows OpenSSH uses this for admin users)
    $SSH "${PC_USER}@${PC_HOST}" \
      "powershell -Command \"\$k=Get-Content 'D:\\remote-pc-access\\tmp_sshkey'; \$f='C:\ProgramData\ssh\administrators_authorized_keys'; Add-Content \$f \$k; icacls \$f /inheritance:r /grant 'SYSTEM:(F)' /grant 'Administrators:(F)' 2>\$null|Out-Null; Remove-Item 'D:\\remote-pc-access\\tmp_sshkey'\"" \
      2>/dev/null && success "SSH key installed — no password needed next run" || warn "SSH key install failed"
  fi
fi

# ── Step 6: Compute hashes + decide what needs updating ──────────────────────
info "Computing change hashes..."

LOCAL_PKG_HASH=$(hash_local  "$ROOT/pc-agent/package.json")
LOCAL_SRC_HASH=$(hash_local  "$ROOT/pc-agent/src" "$ROOT/pc-agent/tsconfig.json")
LOCAL_SCRIPTS_HASH=$(hash_local "$ROOT/scripts/setup-windows.ps1")

PC_PKG_HASH=$(pc_read_hash     "agent-pkg")
PC_SRC_HASH=$(pc_read_hash     "agent-src")
PC_SCRIPTS_HASH=$(pc_read_hash "windows-scripts")

DO_INSTALL=false; DO_BUILD=false; DO_SRC_COPY=false; DO_SCRIPTS=false

[[ "$LOCAL_PKG_HASH"     != "$PC_PKG_HASH"     ]] && DO_INSTALL=true && DO_BUILD=true && DO_SRC_COPY=true
[[ "$LOCAL_SRC_HASH"     != "$PC_SRC_HASH"     ]] && DO_BUILD=true && DO_SRC_COPY=true
[[ "$LOCAL_SCRIPTS_HASH" != "$PC_SCRIPTS_HASH" ]] && DO_SCRIPTS=true

if [[ "$DO_SRC_COPY" == "true" ]]; then
  info "pc-agent source changed — will copy + build"
else
  info "pc-agent source unchanged — skipping copy + build"
fi
if [[ "$DO_INSTALL" == "true" ]]; then
  info "package.json changed — will run npm install"
fi
if [[ "$DO_SCRIPTS" == "true" ]]; then
  info "Windows scripts changed — will copy + run setup"
else
  info "Windows scripts unchanged — running prereq checks only"
fi

# ── Step 6b: Ensure target directories exist on the PC ───────────────────────
$SSH "${PC_USER}@${PC_HOST}" \
  "powershell -Command \"New-Item -ItemType Directory -Force -Path '${PC_PATH_WIN}\\pc-agent' | Out-Null; New-Item -ItemType Directory -Force -Path '${PC_PATH_WIN}\\scripts' | Out-Null\"" \
  2>/dev/null || true

# ── Step 7: Stop the agent task (if running) ─────────────────────────────────
info "Stopping ${TASK_NAME} task..."
$SSH "${PC_USER}@${PC_HOST}" \
  "powershell -Command \"\$ErrorActionPreference='Continue'; Stop-ScheduledTask -TaskName '${TASK_NAME}' 2>\$null; Start-Sleep -Seconds 2\"" \
  2>/dev/null || true
success "Task stopped"

# ── Step 8: Copy pc-agent source files (only if changed) ─────────────────────
if [[ "$DO_SRC_COPY" == "true" ]]; then
  info "Copying pc-agent source files..."
  $SCP -r "${ROOT}/pc-agent/src"              "${PC_USER}@${PC_HOST}:${PC_PATH}/pc-agent/" || die "SCP failed: src/"
  $SCP    "${ROOT}/pc-agent/package.json"     "${PC_USER}@${PC_HOST}:${PC_PATH}/pc-agent/" || die "SCP failed: package.json"
  $SCP    "${ROOT}/pc-agent/tsconfig.json"    "${PC_USER}@${PC_HOST}:${PC_PATH}/pc-agent/" || die "SCP failed: tsconfig.json"
  $SCP    "${ROOT}/pc-agent/apps.config.json" "${PC_USER}@${PC_HOST}:${PC_PATH}/pc-agent/" || die "SCP failed: apps.config.json"
  $SCP    "${ROOT}/pc-agent/.env.example"     "${PC_USER}@${PC_HOST}:${PC_PATH}/pc-agent/" 2>/dev/null || true
  success "Source files copied"
else
  success "pc-agent source unchanged — skipped file copy"
fi

# ── Step 9: Copy Windows scripts (only if changed) ───────────────────────────
if [[ "$DO_SCRIPTS" == "true" ]]; then
  info "Copying Windows scripts..."
  $SCP "${ROOT}/scripts/setup-windows.ps1"  "${PC_USER}@${PC_HOST}:${PC_PATH}/scripts/setup-windows.ps1"  || die "SCP failed: setup-windows.ps1"
  $SCP "${ROOT}/scripts/install-ollama.ps1" "${PC_USER}@${PC_HOST}:${PC_PATH}/scripts/install-ollama.ps1" || die "SCP failed: install-ollama.ps1"
else
  success "Windows scripts unchanged — skipped script copy"
fi

# ── Step 10: Run setup-windows.ps1 (prereqs + conditional build) ─────────────
SETUP_FLAGS=""
[[ "$DO_INSTALL" != "true" ]] && SETUP_FLAGS="$SETUP_FLAGS -SkipNpmInstall"
[[ "$DO_BUILD"   != "true" ]] && SETUP_FLAGS="$SETUP_FLAGS -SkipBuild"

info "Running setup-windows.ps1 on PC (flags:${SETUP_FLAGS:-none})..."
if ! $SSH "${PC_USER}@${PC_HOST}" \
    "powershell -ExecutionPolicy Bypass -File ${PC_PATH_WIN}\\scripts\\setup-windows.ps1${SETUP_FLAGS}"; then
  die "setup-windows.ps1 failed on the PC. Check the output above."
fi
success "PC setup complete"

# Write hashes to PC so next run can skip unchanged work
[[ "$DO_SRC_COPY" == "true" ]] && {
  pc_write_hash "agent-src" "$LOCAL_SRC_HASH"
  pc_write_hash "agent-pkg" "$LOCAL_PKG_HASH"
}
[[ "$DO_SCRIPTS" == "true" ]] && pc_write_hash "windows-scripts" "$LOCAL_SCRIPTS_HASH"

# ── Step 11: Write pc-agent .env (task reads it via dotenv on start) ─────────
info "Writing pc-agent .env..."
$SSH "${PC_USER}@${PC_HOST}" \
  "powershell -Command \"Set-Content -Path '${PC_PATH_WIN}\\pc-agent\\.env' -Value @('RELAY_URL=${RELAY_URL}', 'AGENT_SECRET=${AGENT_SECRET}', 'ALLOWED_SHELL=powershell', 'RECONNECT_INTERVAL=5000')\"" \
  || die "Failed to write .env on PC"
success "pc-agent .env written (RELAY_URL=${RELAY_URL})"

# ── Step 12: Start the scheduled task ────────────────────────────────────────
# Interactive task requires Windows user to be logged into their desktop (physical/RDP).
# Check for active interactive session first.
info "Checking Windows desktop session..."
WIN_SESSION=$($SSH "${PC_USER}@${PC_HOST}" \
  "powershell -Command \"\$u = (Get-WmiObject Win32_ComputerSystem).UserName; if (\$u) { \$u } else { 'none' }\"" \
  2>/dev/null | tr -d '\0\r\n' || echo "none")

if [[ "$WIN_SESSION" == "none" || -z "$WIN_SESSION" ]]; then
  warn "No interactive Windows session detected on the PC."
  warn "The PC agent runs in the user's desktop session (required for screen capture)."
  warn "ACTION REQUIRED: Log into Windows on the PC (physically or via RDP)."
  warn "The agent task will auto-start at logon. Or run from the PC:"
  warn "  Start-ScheduledTask -TaskName '${TASK_NAME}'"
  warn "Skipping task start — local stack will still start."
  TASK_OK=false
else
  info "Windows session active: ${WIN_SESSION}"
  info "Starting ${TASK_NAME} scheduled task..."
  $SSH "${PC_USER}@${PC_HOST}" \
    "powershell -Command \"\$ErrorActionPreference='Continue'; Start-ScheduledTask -TaskName '${TASK_NAME}' 2>\$null | Out-Null\"" \
    2>/dev/null || true

  # Wait up to 15s for node.exe to appear
  info "Waiting for agent process to start..."
  TASK_OK=false
  for i in 1 2 3 4 5; do
    sleep 3
    NODE_UP=$($SSH "${PC_USER}@${PC_HOST}" \
      "powershell -Command \"\$p = Get-Process -Name node -ErrorAction SilentlyContinue; if (\$p) { 'yes' } else { 'no' }\"" \
      2>/dev/null | tr -d '\0\r\n' || echo "no")
    if [[ "$NODE_UP" == "yes" ]]; then
      TASK_OK=true
      break
    fi
    info "  node.exe not running yet — waiting..."
  done

  if [[ "$TASK_OK" == "true" ]]; then
    success "PC agent process running"
  else
    # Gather diagnostics
    LAST_RESULT=$($SSH "${PC_USER}@${PC_HOST}" \
      "powershell -Command \"\$t = Get-ScheduledTaskInfo -TaskName '${TASK_NAME}' -ErrorAction SilentlyContinue; if (\$t) { 'LastResult=' + \$t.LastTaskResult + ' LastRun=' + \$t.LastRunTime } else { 'task-not-found' }\"" \
      2>/dev/null | tr -d '\0\r' || echo "unknown")
    warn "Task did not reach Running state after 15s"
    warn "Task info: ${LAST_RESULT}"
    warn "--- service.log (last 10 lines) ---"
    $SSH "${PC_USER}@${PC_HOST}" \
      "powershell -Command \"if (Test-Path '${PC_PATH_WIN}\\pc-agent\\service.log') { Get-Content '${PC_PATH_WIN}\\pc-agent\\service.log' | Select-Object -Last 10 } else { Write-Host 'No service.log yet' }\"" \
      2>/dev/null || true
    warn "--- screen-capture.log (last 5 lines) ---"
    $SSH "${PC_USER}@${PC_HOST}" \
      "powershell -Command \"if (Test-Path '${PC_PATH_WIN}\\pc-agent\\screen-capture.log') { Get-Content '${PC_PATH_WIN}\\pc-agent\\screen-capture.log' | Select-Object -Last 5 } else { Write-Host 'No screen-capture.log yet' }\"" \
      2>/dev/null || true
    warn "You can continue — the local stack will start. Fix the agent issue separately."
  fi
fi

# Real connection check happens after relay starts (Step 18)

# ── Step 14: Optionally install Ollama ───────────────────────────────────────
if [[ "$INSTALL_OLLAMA" == "true" ]]; then
  echo ""
  info "Running install-ollama.ps1 on PC (may take 10–30 min)..."
  $SSH "${PC_USER}@${PC_HOST}" \
    "powershell -ExecutionPolicy Bypass -File ${PC_PATH_WIN}\\scripts\\install-ollama.ps1" \
    || warn "Ollama install reported errors — check output above."
fi

# ── Step 15: Set up wol-agent Python venv (once) ─────────────────────────────
if [[ ! -f "$ROOT/wol-agent/.venv/bin/python" ]]; then
  info "Setting up wol-agent Python venv (one-time)..."
  (cd "$ROOT/wol-agent" && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -q) \
    || die "wol-agent venv setup failed."
  success "wol-agent venv ready"
fi

# ── Step 16: Build relay-server (skip if unchanged) ──────────────────────────
HASHDIR="$ROOT/.deploy-hashes"
mkdir -p "$HASHDIR"
LOCAL_RELAY_HASH=$(hash_local "$ROOT/relay-server/src" "$ROOT/relay-server/package.json")
STORED_RELAY_HASH=$(cat "$HASHDIR/relay-server.hash" 2>/dev/null || echo "none")

if [[ "$LOCAL_RELAY_HASH" != "$STORED_RELAY_HASH" ]]; then
  info "Building relay-server (changed)..."
  (cd "$ROOT/relay-server" && npm install --silent && npm run build) \
    || die "relay-server build failed."
  echo "$LOCAL_RELAY_HASH" > "$HASHDIR/relay-server.hash"
  success "relay-server built"
else
  info "relay-server unchanged — skipping build"
fi

# ── Step 17: Free required ports ─────────────────────────────────────────────
free_port() {
  local port="$1" name="$2"
  if fuser "${port}/tcp" &>/dev/null; then
    warn "Port ${port} (${name}) in use — killing..."
    fuser -k "${port}/tcp" 2>/dev/null || true
    sleep 1
    if fuser "${port}/tcp" &>/dev/null; then
      die "Port ${port} (${name}) still in use after kill. Free it manually and re-run."
    fi
    success "Port ${port} freed"
  fi
}

info "Checking ports..."
pkill -f "relay-server.*dist/index.js" 2>/dev/null || true
pkill -f "wol-agent.*server.py"        2>/dev/null || true
pkill -f "ng serve"                    2>/dev/null || true
sleep 1
free_port 3001 "relay-server"
free_port 3003 "wol-agent"
free_port 4200 "web-client"

# ── Step 18: Start relay-server + wol-agent in background ────────────────────
mkdir -p "$LOGDIR"
PIDS=()

start_bg() {
  local name="$1" dir="$2" cmd="$3" port="$4"
  info "Starting ${name}..."
  (cd "$dir" && eval "$cmd" >> "$LOGDIR/${name}.log" 2>&1) &
  PIDS+=($!)
  local i
  for i in 1 2 3 4 5; do
    sleep 1
    if fuser "${port}/tcp" &>/dev/null; then
      success "${name} started (PID ${PIDS[-1]}) — logs: .logs/${name}.log"
      return 0
    fi
  done
  error "${name} failed to bind port ${port}. Last log:"
  tail -20 "$LOGDIR/${name}.log" 2>/dev/null || true
  die "${name} did not start."
}

cleanup_stack() {
  echo ""
  info "Shutting down local services..."
  for pid in "${PIDS[@]-}"; do kill "$pid" 2>/dev/null || true; done
  info "Done."
}
trap cleanup_stack INT TERM

# Truncate relay log so agent-connected grep only matches THIS run
> "$LOGDIR/relay-server.log"

start_bg "relay-server" "$ROOT/relay-server" "npm start"                    3001
start_bg "wol-agent"    "$ROOT/wol-agent"    ".venv/bin/python server.py"  3003

# ── Step 19: Verify agent connects to relay ───────────────────────────────────
info "Waiting for PC agent to connect to relay (up to 20s)..."
AGENT_CONNECTED=false
for i in $(seq 1 10); do
  sleep 2
  if grep -q "PC Agent connected" "$LOGDIR/relay-server.log" 2>/dev/null; then
    AGENT_CONNECTED=true
    break
  fi
done

if [[ "$AGENT_CONNECTED" == "true" ]]; then
  success "PC Agent connected to relay!"
else
  warn "PC agent has not connected yet."
  warn "Relay log tail:"
  tail -10 "$LOGDIR/relay-server.log" 2>/dev/null || true
  warn "Agent log tail (fetching over SSH)..."
  $SSH "${PC_USER}@${PC_HOST}" \
    "powershell -Command \"if (Test-Path '${PC_PATH_WIN}\\pc-agent\\service.log') { Get-Content '${PC_PATH_WIN}\\pc-agent\\service.log' | Select-Object -Last 10 } else { Write-Host 'No service.log' }\"" \
    2>/dev/null || true
  warn "The web UI will still open — keep an eye on the relay log."
fi

# ── Step 20: Summary ─────────────────────────────────────────────────────────
echo ""
success "==========================================="
success " Stack is up"
info "  relay-server : http://localhost:3001"
info "  wol-agent    : http://localhost:3003"
info "  web-client   : http://localhost:4200"
info "  Relay log    : tail -f .logs/relay-server.log"
success "==========================================="
info "Press Ctrl+C to stop all local services."
echo ""

# ── Step 21: Start web-client (foreground — keeps script alive) ───────────────
cd "$ROOT/web-client" && npx ng serve --open --port 4200
