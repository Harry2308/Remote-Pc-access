#!/usr/bin/env bash
# update-and-restart.sh
# Pushes latest code to the PC, rebuilds everything, and starts the full local stack.
# Run this after any code change, or to start the stack fresh.
#
# Usage (from repo root):
#   bash scripts/update-and-restart.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PC_HOST="192.168.0.137"
PC_USER="unger"
PC_PATH="D:/remote-pc-access"
PC_PATH_WIN="D:\\remote-pc-access"
NSSM="C:\\Windows\\System32\\nssm.exe"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[update]${NC} $*"; }
success() { echo -e "${GREEN}[update]${NC} $*"; }
warn()    { echo -e "${YELLOW}[update]${NC} $*"; }
error()   { echo -e "${RED}[update]${NC}  $*"; }

# ── 0. Sanity check — .env must be configured ─────────────────────────────────
RELAY_ENV="$ROOT/relay-server/.env"
AGENT_SECRET=$(grep '^AGENT_SECRET=' "$RELAY_ENV" | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
if [[ -z "$AGENT_SECRET" || "$AGENT_SECRET" == *"change-this"* ]]; then
  error "relay-server/.env is not configured. Run first-time setup first:"
  error "  See SETUP.md for instructions."
  exit 1
fi

# ── 1. Open one SSH connection for the whole script ───────────────────────────
SOCKET="/tmp/update-ssh-$$"
SSH="ssh -o ControlMaster=auto -o ControlPath=${SOCKET} -o ControlPersist=120"
SCP="scp -o ControlMaster=auto -o ControlPath=${SOCKET} -o ControlPersist=120"

cleanup_ssh() { ssh -O exit -o ControlPath="${SOCKET}" "${PC_USER}@${PC_HOST}" 2>/dev/null || true; }
trap cleanup_ssh EXIT

info "Connecting to ${PC_USER}@${PC_HOST} (enter password once)..."
$SSH "${PC_USER}@${PC_HOST}" "echo connected" > /dev/null
success "SSH connection established"

# ── 2. Stop the Windows service ───────────────────────────────────────────────
info "Stopping RemotePCAgent service..."
$SSH "${PC_USER}@${PC_HOST}" "powershell -Command \"
  \$ErrorActionPreference='Continue'
  ${NSSM} stop RemotePCAgent 2>\$null | Out-Null
  Start-Sleep -Seconds 2
\"" 2>/dev/null || true
success "Service stopped"

# ── 3. Copy updated pc-agent source files ────────────────────────────────────
info "Copying pc-agent source files..."
$SCP -r "${ROOT}/pc-agent/src"               "${PC_USER}@${PC_HOST}:${PC_PATH}/pc-agent/"
$SCP    "${ROOT}/pc-agent/package.json"      "${PC_USER}@${PC_HOST}:${PC_PATH}/pc-agent/"
$SCP    "${ROOT}/pc-agent/tsconfig.json"     "${PC_USER}@${PC_HOST}:${PC_PATH}/pc-agent/"
$SCP    "${ROOT}/pc-agent/apps.config.json"  "${PC_USER}@${PC_HOST}:${PC_PATH}/pc-agent/"
success "Source files copied"

# ── 4. Install dependencies & build on the PC ────────────────────────────────
info "Installing dependencies and building on PC..."
$SSH "${PC_USER}@${PC_HOST}" "powershell -ExecutionPolicy Bypass -Command \"
  Push-Location '${PC_PATH_WIN}\\pc-agent'
  npm install --silent
  npm run build
  Pop-Location
\""
success "pc-agent built on PC"

# ── 5. Restart the Windows service ───────────────────────────────────────────
info "Restarting RemotePCAgent service..."
$SSH "${PC_USER}@${PC_HOST}" "powershell -Command \"
  \$ErrorActionPreference = 'Continue'
  ${NSSM} stop  RemotePCAgent 2>\$null | Out-Null
  Start-Sleep -Seconds 2
  ${NSSM} start RemotePCAgent 2>\$null | Out-Null
  Start-Sleep -Seconds 2
  ${NSSM} status RemotePCAgent
\""
success "RemotePCAgent service restarted"

# ── 6. Verify the service came up ────────────────────────────────────────────
STATUS=$($SSH "${PC_USER}@${PC_HOST}" "powershell -Command \"${NSSM} status RemotePCAgent\"" 2>/dev/null || echo "UNKNOWN")
if echo "$STATUS" | grep -q "SERVICE_RUNNING"; then
  success "PC agent: SERVICE_RUNNING"
else
  warn "PC agent status: $STATUS — check D:\\remote-pc-access\\pc-agent\\service.log"
fi

# ── 7. Set up wol-agent venv if not present ───────────────────────────────────
if [[ ! -f "$ROOT/wol-agent/.venv/bin/python" ]]; then
  info "Setting up wol-agent Python venv (one-time)..."
  (cd "$ROOT/wol-agent" && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -q)
  success "wol-agent venv ready"
fi

# ── 8. Rebuild relay-server ───────────────────────────────────────────────────
info "Rebuilding relay-server..."
(cd "$ROOT/relay-server" && npm install --silent && npm run build)
success "relay-server rebuilt"

# ── 9. Kill any leftover local stack processes ────────────────────────────────
info "Cleaning up previous stack processes..."
pkill -f "relay-server.*dist/index.js" 2>/dev/null || true
pkill -f "wol-agent.*server.py"        2>/dev/null || true
pkill -f "ng serve"                    2>/dev/null || true
sleep 1

# ── 10. Start relay-server + wol-agent in background ─────────────────────────
LOGDIR="$ROOT/.logs"
mkdir -p "$LOGDIR"
PIDS=()

start_bg() {
  local name="$1" dir="$2" cmd="$3"
  info "Starting ${name}..."
  (cd "$dir" && eval "$cmd" >> "$LOGDIR/${name}.log" 2>&1) &
  PIDS+=($!)
  success "${name} started (PID ${PIDS[-1]}) — logs: .logs/${name}.log"
}

cleanup_stack() {
  echo ""
  info "Shutting down local services..."
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  info "Done."
}
trap cleanup_stack INT TERM

start_bg "relay-server" "$ROOT/relay-server" "npm start"
sleep 1
start_bg "wol-agent" "$ROOT/wol-agent" ".venv/bin/python server.py"
sleep 1

# ── 11. Confirm relay is up ───────────────────────────────────────────────────
if grep -q "PC Agent connected" "$LOGDIR/relay-server.log" 2>/dev/null; then
  success "PC Agent already connected to relay"
fi

echo ""
success "==========================================="
success " Stack is up — pc-agent redeployed"
info "  relay-server : http://localhost:3001"
info "  wol-agent    : http://localhost:3003"
info "  web-client   : http://localhost:4200"
info "  PC agent log : .logs/relay-server.log"
success "==========================================="
info "Press Ctrl+C to stop all local services."
echo ""

# ── 12. Start web-client (foreground — keeps script alive) ───────────────────
cd "$ROOT/web-client" && npx ng serve --open
