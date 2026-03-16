# Project Context — Remote PC Access

> This file is included at the start of every prompt session to maintain continuity.
> Keep it up to date. Always read `planning.md` and `implemented.md` alongside this file.

---

## What This Project Is

A self-hosted remote PC access system. Web app first (PWA), extendable to native mobile.
Target: Windows 11 Home PC, accessible from anywhere in the world.

---

## Standing Rules for All Sessions

1. **Always read `planning.md`, `implemented.md`, and `context.md` at the start of every session** before writing any code.
2. **Always update `implemented.md`** at the end of every session with what was completed.
3. **Never implement anything not in the plan** without first adding it to `planning.md`.
4. **Microservice architecture** — keep services decoupled and in separate directories.
5. **Languages:** JavaScript/TypeScript (Node.js) for backend services and React frontend. Python for the WoL agent only. No other languages unless unavoidable.
6. **Windows 11 Home** — no Hyper-V, no enterprise features. Everything must work on the base edition.
7. **Security first** — all endpoints require JWT auth. No unauthenticated routes except `POST /auth/login`.
8. **No screen capture** in scope for now (listed as future extension only).
9. **Do not commit secrets** — use `.env` files with `.env.example` templates.

---

## Project Structure (Target)

```
remote-pc-access/
├── relay-server/          # Node.js — hosted on public VPS / behind Cloudflare Tunnel
│   ├── auth-service/
│   ├── tunnel-service/
│   └── api-gateway/
│
├── pc-agent/              # Node.js — runs on Windows 11 PC
│   ├── terminal-service/
│   ├── app-service/
│   ├── power-service/
│   └── claude-bridge/
│
├── wol-agent/             # Python — runs on always-on LAN device
│
├── web-client/            # React PWA
│
├── planning.md
├── implemented.md
└── context.md
```

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Angular + TypeScript + Angular Material |
| Terminal UI | xterm.js |
| Relay backend | Node.js + Express + ws |
| PC Agent | Node.js + node-pty |
| WoL Agent | Python 3 |
| Auth | JWT + bcrypt + speakeasy (TOTP) |
| Tunnel | Cloudflare Tunnel (default) or self-hosted FRP |

---

## Current Implementation Phase

**Phases 1–4 + Ollama/sysinfo complete.** Angular build passes, relay TypeScript clean.

**PC details:** IP `192.168.0.137`, user `unger`, drive `D:`, MAC `b4:2e:99:4c:35:8f`

**Next to implement:**
- Phase 5: Claude Code bridge (pc-agent claude-bridge service + Angular chat tab)
- Phase 6: PWA manifest + service worker, `.gitignore`, `docker-compose.yml`
- App Launcher UI page (API exists, no UI)
- File browser (browse/download files from PC)

---

## Key Decisions Made

| Decision | Chosen | Reason |
|---|---|---|
| NAT traversal | Cloudflare Tunnel (start) | Free, zero config, WSS support |
| Terminal backend | node-pty | Best Windows ConPTY support |
| WoL device | Separate always-on LAN device | PC is off, agent can't run |
| PC agent deployment | Windows Service via nssm | Auto-start on boot without login |
| App launcher | Whitelisted commands in JSON config | Prevents command injection |

---

## Environment Notes

- Development machine: Linux (Kali), working dir `/home/harry/Desktop/Remote-Pc-access`
- Target deployment (agent): Windows 11 Home PC (same LAN)
- Target deployment (relay): VPS or Cloudflare Tunnel
- WoL device: TBD (Raspberry Pi / router / NAS)
