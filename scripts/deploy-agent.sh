#!/usr/bin/env bash
# deploy-agent.sh — First-time setup: copies pc-agent to the Windows PC,
# installs all dependencies, writes the .env automatically, and starts the service.
#
# Run from repo root on your LAPTOP:
#   ./scripts/deploy-agent.sh          # deploy agent only
#   ./scripts/deploy-agent.sh --ollama # deploy agent + install Ollama

set -euo pipefail

PC_HOST="192.168.0.137"
PC_USER="unger"
PC_PATH="D:/remote-pc-access"
PC_PATH_WIN="D:\\remote-pc-access"
NSSM="C:\\Windows\\System32\\nssm.exe"

INSTALL_OLLAMA=false
for arg in "$@"; do [[ "$arg" == "--ollama" ]] && INSTALL_OLLAMA=true; done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${CYAN}[deploy]${NC} $*"; }
success() { echo -e "${GREEN}[deploy]${NC} $*"; }
warn()    { echo -e "${YELLOW}[deploy]${NC} $*"; }
error()   { echo -e "${RED}[deploy]${NC} $*"; }

# ─── Read config from relay-server/.env ──────────────────────────────────────
RELAY_ENV="$ROOT/relay-server/.env"
if [[ ! -f "$RELAY_ENV" ]]; then
  error "relay-server/.env not found. Run the first-time setup steps first."
  exit 1
fi

AGENT_SECRET=$(grep '^AGENT_SECRET=' "$RELAY_ENV" | cut -d= -f2- | tr -d '"' | tr -d "'")
if [[ -z "$AGENT_SECRET" || "$AGENT_SECRET" == *"change-this"* ]]; then
  error "AGENT_SECRET in relay-server/.env is still a placeholder."
  error "Edit relay-server/.env first, then re-run this script."
  exit 1
fi

# ─── Auto-detect laptop's LAN IP ─────────────────────────────────────────────
LAPTOP_IP=$(ip route get "${PC_HOST}" | grep -oP 'src \K[\d.]+' || true)
if [[ -z "$LAPTOP_IP" ]]; then
  error "Could not auto-detect laptop LAN IP. Set LAPTOP_IP manually in this script."
  exit 1
fi
RELAY_URL="ws://${LAPTOP_IP}:3001"
info "Laptop IP detected: ${LAPTOP_IP}  →  RELAY_URL=${RELAY_URL}"

# ─── SSH ControlMaster — one password prompt for the whole script ─────────────
SOCKET="/tmp/deploy-ssh-$$"
SSH_OPTS="-o ControlMaster=auto -o ControlPath=${SOCKET} -o ControlPersist=60"
SCP_OPTS="-o ControlMaster=auto -o ControlPath=${SOCKET} -o ControlPersist=60"

info "=== Deploying pc-agent to ${PC_USER}@${PC_HOST} ==="
info "Enter your Windows password once:"
ssh $SSH_OPTS "${PC_USER}@${PC_HOST}" "echo connected" > /dev/null

cleanup_ssh() { ssh -O exit -o ControlPath="${SOCKET}" "${PC_USER}@${PC_HOST}" 2>/dev/null || true; }
trap cleanup_ssh EXIT

# ─── 1. Create target directories on PC ──────────────────────────────────────
info "Creating directories on PC..."
ssh $SSH_OPTS "${PC_USER}@${PC_HOST}" "powershell -Command \"
  New-Item -ItemType Directory -Force -Path '${PC_PATH_WIN}\\pc-agent' | Out-Null
  New-Item -ItemType Directory -Force -Path '${PC_PATH_WIN}\\scripts'  | Out-Null
\""

# ─── 2. Copy pc-agent source ─────────────────────────────────────────────────
info "Copying pc-agent source files..."
scp $SCP_OPTS -r "${ROOT}/pc-agent/src"              "${PC_USER}@${PC_HOST}:${PC_PATH}/pc-agent/"
scp $SCP_OPTS    "${ROOT}/pc-agent/package.json"     "${PC_USER}@${PC_HOST}:${PC_PATH}/pc-agent/"
scp $SCP_OPTS    "${ROOT}/pc-agent/tsconfig.json"    "${PC_USER}@${PC_HOST}:${PC_PATH}/pc-agent/"
scp $SCP_OPTS    "${ROOT}/pc-agent/apps.config.json" "${PC_USER}@${PC_HOST}:${PC_PATH}/pc-agent/"
scp $SCP_OPTS    "${ROOT}/pc-agent/.env.example"     "${PC_USER}@${PC_HOST}:${PC_PATH}/pc-agent/"

# ─── 3. Copy scripts ─────────────────────────────────────────────────────────
info "Copying scripts..."
scp $SCP_OPTS "${ROOT}/scripts/setup-windows.ps1"  "${PC_USER}@${PC_HOST}:${PC_PATH}/scripts/setup-windows.ps1"
scp $SCP_OPTS "${ROOT}/scripts/install-ollama.ps1" "${PC_USER}@${PC_HOST}:${PC_PATH}/scripts/install-ollama.ps1"

# ─── 4. Run setup script (installs Node, NSSM, builds agent) ─────────────────
info "Running setup-windows.ps1 on PC (installs deps, builds agent — may take a few minutes)..."
ssh $SSH_OPTS "${PC_USER}@${PC_HOST}" \
    "powershell -ExecutionPolicy Bypass -File ${PC_PATH_WIN}\\scripts\\setup-windows.ps1"

# ─── 5. Write .env on PC automatically ───────────────────────────────────────
info "Writing pc-agent .env on PC..."
ssh $SSH_OPTS "${PC_USER}@${PC_HOST}" "powershell -Command \"
  Set-Content -Path '${PC_PATH_WIN}\\pc-agent\\.env' -Value @'
RELAY_URL=${RELAY_URL}
AGENT_SECRET=${AGENT_SECRET}
ALLOWED_SHELL=powershell
RECONNECT_INTERVAL=5000
'@
\""
success "pc-agent .env written (RELAY_URL=${RELAY_URL})"

# ─── 6. Start the service ─────────────────────────────────────────────────────
info "Starting RemotePCAgent service..."
ssh $SSH_OPTS "${PC_USER}@${PC_HOST}" "powershell -Command \"
  \$ErrorActionPreference = 'Continue'
  ${NSSM} stop RemotePCAgent 2>\$null | Out-Null
  Start-Sleep -Seconds 1
  ${NSSM} start RemotePCAgent | Out-Null
  Start-Sleep -Seconds 2
  ${NSSM} status RemotePCAgent
\""

# ─── 7. Optionally install Ollama ────────────────────────────────────────────
if [[ "$INSTALL_OLLAMA" == "true" ]]; then
  echo ""
  info "Running install-ollama.ps1 on PC (may take 10–30 min for model downloads)..."
  ssh $SSH_OPTS "${PC_USER}@${PC_HOST}" \
      "powershell -ExecutionPolicy Bypass -File ${PC_PATH_WIN}\\scripts\\install-ollama.ps1"
fi

echo ""
success "=== Deployment complete ==="
info "PC agent is running and connected to relay at ${RELAY_URL}"
info ""
info "Next: start the local stack on your laptop:"
info "  bash scripts/update-and-restart.sh"
