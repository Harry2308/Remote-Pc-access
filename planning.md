# Remote PC Access — Planning Document

## Overview

A self-hosted, web-based remote access system for a Windows 11 Home PC, accessible from anywhere in the world. Designed as a Progressive Web App (PWA) that works in the browser today and can be wrapped as a native mobile app later.

No screen mirroring is the primary goal — the focus is on **command execution, terminal access, application launching, power management, and Claude Code integration**.

---

## Core Requirements

| Requirement | Approach |
|---|---|
| Wake PC from sleep | Wake-on-LAN magic packet via local relay agent |
| Wake PC from full shutdown | WoL requires always-on LAN device; document BIOS setup |
| Remote terminal / shell | xterm.js (frontend) + node-pty (backend) over WebSocket |
| Launch applications remotely | Command execution API via the PC agent |
| Claude Code server integration | Expose local Claude Code MCP server through PC agent |
| Shutdown / sleep remotely | Shutdown command via PC agent API |
| Access from anywhere | Reverse tunnel relay (Cloudflare Tunnel or self-hosted FRP) |
| Authentication | JWT + optional TOTP 2FA |
| Mobile-ready | React PWA, responsive design |

---

## Architecture

### High-Level Diagram

```
┌────────────────────────────────────────────────────────────────┐
│                         INTERNET                               │
│                                                                │
│   [Browser / Mobile PWA]                                      │
│          │  HTTPS + WSS                                       │
│          ▼                                                     │
│   [Relay Server — VPS or Cloudflare Tunnel]                   │
│          │  Reverse WebSocket tunnel                          │
│          ▼                                                     │
│   [Home Network]                                              │
│     ├── [PC Agent — Node.js on Windows 11]                    │
│     │       ├── Terminal service (node-pty)                   │
│     │       ├── App launcher service                          │
│     │       ├── Power management API                          │
│     │       └── Claude Code MCP bridge                        │
│     └── [WoL Relay — Raspberry Pi / Router / always-on device]│
│              └── Sends WoL magic packets when PC is off       │
└────────────────────────────────────────────────────────────────┘
```

### Services (Microservice Architecture)

```
remote-pc-access/
├── relay-server/          # Node.js — hosted on public VPS
│   ├── auth-service/      # JWT + TOTP authentication
│   ├── tunnel-service/    # WebSocket proxy/relay
│   └── api-gateway/       # REST API + WS routing
│
├── pc-agent/              # Node.js — runs on Windows 11 PC
│   ├── terminal-service/  # node-pty shell sessions
│   ├── app-service/       # application launcher
│   ├── power-service/     # shutdown, sleep, status
│   └── claude-bridge/     # Claude Code MCP proxy
│
├── wol-agent/             # Python — runs on always-on LAN device
│   └── server.py          # HTTP endpoint → sends WoL magic packet
│
└── web-client/            # React PWA
    ├── terminal/          # xterm.js terminal UI
    ├── launcher/          # app/command launcher UI
    ├── dashboard/         # PC status, power controls
    └── claude/            # Claude Code chat UI
```

---

## Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Frontend | Angular + TypeScript | PWA support, strong architecture, DI system |
| Terminal UI | xterm.js | Industry standard browser terminal |
| Relay backend | Node.js + Express + ws | WebSocket native support, fast |
| PC Agent | Node.js + node-pty | Best Windows ConPTY support |
| WoL Agent | Python 3 | Simple UDP socket, lightweight |
| Auth | JWT + bcrypt + speakeasy (TOTP) | Standard, no external dependency |
| Tunnel | Cloudflare Tunnel (free) or FRP | No port forwarding needed |
| VPN (optional) | WireGuard | Works on Windows 11 Home |
| Styling | Angular Material + SCSS | Angular-native component library |

---

## Detailed Service Descriptions

### 1. Relay Server (`relay-server/`)

**Hosted on:** VPS (e.g., DigitalOcean $4/mo, Hetzner, etc.) or behind Cloudflare Tunnel

**Responsibilities:**
- Serve the React web client
- Authenticate users (JWT)
- Proxy WebSocket connections to the PC Agent (the PC agent connects outbound to the relay, solving NAT)
- Forward WoL requests to the WoL Agent

**Key endpoints:**
```
POST /auth/login          → returns JWT
POST /auth/refresh        → refresh token
GET  /api/status          → PC online status
POST /api/power/sleep     → send sleep command
POST /api/power/shutdown  → send shutdown command
POST /api/power/wake      → trigger WoL
WS   /terminal            → proxied terminal session
WS   /claude              → proxied Claude bridge session
```

---

### 2. PC Agent (`pc-agent/`)

**Runs on:** Windows 11 PC (as a background Node.js process / Windows Service)

**Responsibilities:**
- Connects outbound to relay server via WebSocket (solves NAT traversal without port forwarding)
- Spawns terminal sessions using node-pty (PowerShell or cmd.exe)
- Executes named application launch commands
- Executes sleep/shutdown via `shutdown /h` and `shutdown /s /t 0`
- Bridges Claude Code MCP server locally

**Windows Service setup:** Use `node-windows` or `nssm` to register as a Windows Service that starts on boot.

---

### 3. WoL Agent (`wol-agent/`)

**Runs on:** Always-on device on the same LAN (Raspberry Pi, NAS, or even the router if it supports custom scripts)

**Responsibilities:**
- Exposes a simple HTTP endpoint
- On request, sends a WoL magic packet (UDP broadcast to port 9) with the PC's MAC address

**Why separate?** When the PC is fully off or in S5 (soft-off) state, the PC agent cannot run. The WoL agent must be a separate always-on device.

**Note on WoL from full shutdown (S5):** Requires:
- BIOS setting: "Wake on LAN" or "Power on by PCI-E" enabled
- Windows: Device Manager → Network Adapter → Power Management → "Allow this device to wake the computer" checked
- Router: ARP table entry kept or static DHCP lease for the PC

---

### 4. Web Client (`web-client/`)

**PWA features:**
- Installable on mobile home screen
- Service worker for offline shell (login/status page)
- Responsive design for mobile use

**Screens:**
- Login — JWT auth with optional TOTP
- Dashboard — PC status, quick power buttons
- Terminal — full xterm.js session
- App Launcher — predefined commands / app shortcuts
- Claude Chat — send prompts, get responses via local Claude Code

---

## Claude Code Integration

The PC Agent includes a `claude-bridge` service that:
1. Spawns `claude` CLI as a subprocess in a specific repo directory
2. Exposes a WebSocket API that forwards prompts and returns streamed responses
3. The web client shows a chat-like UI

This allows querying Claude Code about a specific local repository from any device.

**Setup requirement:** `claude` must be installed on the Windows 11 PC and authenticated.

---

## Security Model

| Concern | Mitigation |
|---|---|
| Authentication | JWT (short-lived access token + refresh token) |
| 2FA | Optional TOTP (Google Authenticator compatible) |
| Transport | TLS everywhere (HTTPS + WSS) |
| WoL unauthenticated risk | WoL requests require valid JWT |
| PC Agent exposed | Agent connects outbound only — no open inbound ports |
| Command injection | Input sanitized; only whitelisted app commands allowed in launcher |
| Secrets | `.env` files, never committed |

---

## Implementation Phases

### Phase 1 — Foundation
- [ ] Scaffold monorepo structure
- [x] Set up `relay-server` with Express + WebSocket
- [x] Set up `pc-agent` skeleton connecting to relay
- [x] Basic auth (username/password → JWT)

### Phase 2 — Terminal
- [x] Integrate node-pty in `pc-agent`
- [x] Integrate xterm.js in `web-client`
- [x] WebSocket terminal session proxied through relay

### Phase 3 — Power Management
- [ ] Power API endpoints (sleep, shutdown, status)
- [ ] PC agent implements `shutdown` commands
- [ ] `wol-agent` Python script
- [ ] Wake button in dashboard

### Phase 4 — App Launcher
- [ ] Configurable command list (JSON config)
- [ ] REST endpoint to trigger named commands
- [ ] Launcher UI in web client

### Phase 5 — Claude Code Bridge
- [ ] Claude bridge service in PC agent
- [ ] Chat UI in web client
- [ ] Repo path configurable

### Phase 6 — Polish & PWA
- [ ] PWA manifest + service worker
- [ ] Mobile responsive design
- [ ] TOTP 2FA
- [ ] Docker Compose for relay server

---

## Tunnel Strategy

### Option A — Cloudflare Tunnel (recommended for start)
- Free, no VPS needed
- Install `cloudflared` on Windows PC
- `cloudflared tunnel --url http://localhost:3001` (pc-agent port)
- Cloudflare provides a stable public HTTPS/WSS URL

### Option B — Self-hosted FRP (more control)
- Rent a $4/mo VPS
- Run `frps` (server) on VPS, `frpc` (client) on Windows PC
- Full control, supports WebSocket and TCP

### Recommendation
Start with Cloudflare Tunnel for zero-cost setup. Migrate to self-hosted FRP if more control is needed.

---

## Future Extensions
- Screen sharing Phase 2: FFmpeg H.264 + MSE for lower bandwidth / higher quality
- Screen sharing Phase 3: Mouse + keyboard input injection (interactive remote desktop)
- File browser / upload / download
- Mobile native app wrapper (Capacitor or React Native WebView)
- Multiple PC support
- Audit log of all commands run remotely
- Notification when PC comes online
