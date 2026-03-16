#!/usr/bin/env bash
# quickstart.sh — Start the entire Remote PC Access stack locally
# Usage: ./quickstart.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDS=()

# ─── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[quickstart]${NC} $*"; }
success() { echo -e "${GREEN}[quickstart]${NC} $*"; }
warn()    { echo -e "${YELLOW}[quickstart]${NC} $*"; }
error()   { echo -e "${RED}[quickstart]${NC} $*"; }

# ─── Cleanup — kill all children on exit ──────────────────────────────────────
cleanup() {
  echo ""
  info "Shutting down all services..."
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  info "Done. Goodbye."
}
trap cleanup INT TERM EXIT

# ─── Dependency checks ────────────────────────────────────────────────────────
check_command() {
  if ! command -v "$1" &>/dev/null; then
    error "Required command not found: $1 — please install it first"
    exit 1
  fi
}

check_command node
check_command npm
check_command python3

# ─── .env bootstrapping ───────────────────────────────────────────────────────
bootstrap_env() {
  local dir="$1"
  if [[ ! -f "$dir/.env" ]]; then
    if [[ -f "$dir/.env.example" ]]; then
      warn "No .env found in $dir — copying from .env.example (edit before production use)"
      cp "$dir/.env.example" "$dir/.env"
    fi
  fi
}

bootstrap_env "$ROOT/relay-server"
bootstrap_env "$ROOT/pc-agent"
bootstrap_env "$ROOT/wol-agent"

# ─── Install dependencies if node_modules missing ─────────────────────────────
install_if_needed() {
  local dir="$1"
  local name="$2"
  if [[ ! -d "$dir/node_modules" ]]; then
    info "Installing $name dependencies..."
    (cd "$dir" && npm install --silent)
    success "$name dependencies installed"
  fi
}

install_if_needed "$ROOT/relay-server" "relay-server"
install_if_needed "$ROOT/web-client"   "web-client"

# ─── Python virtual environment for wol-agent ────────────────────────────────
if [[ ! -d "$ROOT/wol-agent/.venv" ]]; then
  info "Creating Python venv for wol-agent..."
  python3 -m venv "$ROOT/wol-agent/.venv"
  "$ROOT/wol-agent/.venv/bin/pip" install -q -r "$ROOT/wol-agent/requirements.txt"
  success "wol-agent venv ready"
fi

# ─── Always rebuild relay-server TypeScript ──────────────────────────────────
info "Building relay-server..."
(cd "$ROOT/relay-server" && npm run build)
success "relay-server built"

# ─── Start services ───────────────────────────────────────────────────────────
start_service() {
  local name="$1"
  local dir="$2"
  local cmd="$3"
  local logfile="$ROOT/.logs/${name}.log"

  mkdir -p "$ROOT/.logs"
  info "Starting ${name}..."
  (cd "$dir" && eval "$cmd" > "$logfile" 2>&1) &
  local pid=$!
  PIDS+=("$pid")
  success "${name} started (PID ${pid}) — logs: .logs/${name}.log"
}

start_service "relay-server" "$ROOT/relay-server" "npm start"
sleep 1  # Give relay a moment to bind its port before the agent connects

# wol-agent is optional for local dev (you may not have an always-on device here)
start_service "wol-agent"    "$ROOT/wol-agent"    ".venv/bin/python server.py"

# Angular dev server (foreground-friendly — last to start so its output appears in terminal)
info "Starting web-client (Angular dev server)..."
info "──────────────────────────────────────────────"
success "All backend services running."
info "relay-server : http://localhost:3001"
info "wol-agent    : http://localhost:3003"
info "web-client   : http://localhost:4200"
info "──────────────────────────────────────────────"
info "Press Ctrl+C to stop everything."
echo ""

cd "$ROOT/web-client" && npx ng serve --open
