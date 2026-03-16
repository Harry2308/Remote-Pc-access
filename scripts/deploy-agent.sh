#!/usr/bin/env bash
# deploy-agent.sh — Copy pc-agent to the Windows PC and run setup remotely
# Run this from your LAPTOP (Linux), not the Windows PC.
#
# Usage:
#   ./scripts/deploy-agent.sh          # deploy agent only
#   ./scripts/deploy-agent.sh --ollama # deploy agent + install Ollama

set -euo pipefail

PC_HOST="192.168.0.137"
PC_USER="unger"
PC_PATH="D:/remote-pc-access"
PC_PATH_WIN="D:\\remote-pc-access"

INSTALL_OLLAMA=false
for arg in "$@"; do [[ "$arg" == "--ollama" ]] && INSTALL_OLLAMA=true; done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${CYAN}[deploy]${NC} $*"; }
success() { echo -e "${GREEN}[deploy]${NC} $*"; }
warn()    { echo -e "${YELLOW}[deploy]${NC} $*"; }

# ─── SSH ControlMaster — one password prompt for the whole script ─────────────
SOCKET="/tmp/deploy-ssh-$$"
SSH_OPTS="-o ControlMaster=auto -o ControlPath=${SOCKET} -o ControlPersist=60"
SCP_OPTS="-o ControlMaster=auto -o ControlPath=${SOCKET} -o ControlPersist=60"

# Open the master connection (this is the only password prompt)
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

# ─── 2. Copy pc-agent source (excluding node_modules and dist) ───────────────
info "Copying pc-agent source files..."
scp $SCP_OPTS -r "${ROOT}/pc-agent/src"              "${PC_USER}@${PC_HOST}:${PC_PATH}/pc-agent/"
scp $SCP_OPTS    "${ROOT}/pc-agent/package.json"     "${PC_USER}@${PC_HOST}:${PC_PATH}/pc-agent/"
scp $SCP_OPTS    "${ROOT}/pc-agent/tsconfig.json"    "${PC_USER}@${PC_HOST}:${PC_PATH}/pc-agent/"
scp $SCP_OPTS    "${ROOT}/pc-agent/apps.config.json" "${PC_USER}@${PC_HOST}:${PC_PATH}/pc-agent/"
scp $SCP_OPTS    "${ROOT}/pc-agent/.env.example"     "${PC_USER}@${PC_HOST}:${PC_PATH}/pc-agent/"

# ─── 3. Copy all scripts ─────────────────────────────────────────────────────
info "Copying scripts..."
scp $SCP_OPTS "${ROOT}/scripts/setup-windows.ps1"  "${PC_USER}@${PC_HOST}:${PC_PATH}/scripts/setup-windows.ps1"
scp $SCP_OPTS "${ROOT}/scripts/install-ollama.ps1" "${PC_USER}@${PC_HOST}:${PC_PATH}/scripts/install-ollama.ps1"

# ─── 4. Run setup script on PC ───────────────────────────────────────────────
info "Running setup-windows.ps1 on PC (installs Node.js, Python, Git, NSSM, builds agent)..."
warn "This may take several minutes — node-pty compiles native bindings."
echo ""

ssh $SSH_OPTS "${PC_USER}@${PC_HOST}" \
    "powershell -ExecutionPolicy Bypass -File ${PC_PATH_WIN}\\scripts\\setup-windows.ps1"

# ─── 5. Optionally install Ollama ────────────────────────────────────────────
if [[ "$INSTALL_OLLAMA" == "true" ]]; then
    echo ""
    info "Running install-ollama.ps1 on PC (installs Ollama, pulls models — may take 10–30 min)..."
    warn "Model downloads: llama3.2:3b (~2GB), codellama:7b (~4GB), mistral:7b (~4GB)"
    ssh $SSH_OPTS "${PC_USER}@${PC_HOST}" \
        "powershell -ExecutionPolicy Bypass -File ${PC_PATH_WIN}\\scripts\\install-ollama.ps1"
fi

echo ""
success "=== Deployment complete ==="
info ""
info "Next: configure the agent .env on the PC:"
info "  ssh ${PC_USER}@${PC_HOST}"
info "  notepad ${PC_PATH_WIN}\\pc-agent\\.env"
info "  (set RELAY_URL and AGENT_SECRET, then:)"
info "  nssm start RemotePCAgent"
info ""
if [[ "$INSTALL_OLLAMA" != "true" ]]; then
    info "To also install Ollama, run:"
    info "  ./scripts/deploy-agent.sh --ollama"
fi
