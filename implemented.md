# Implemented — Progress Log

This file tracks everything that has been implemented so far. Updated after every prompt session.

---

## Session 5 — 2026-03-16 (Bug fixes + Tests)

### Bug fixes
- **Auth login** — `bcrypt.compare` silently returns `false` (not throws) for non-hash strings; added `isBcryptHash` regex check to fall back to plain-text comparison in dev
- **UI** — missing Material Icons + Roboto font links in `index.html`; all icons were blank boxes
- **Architecture** — split `index.ts` into `app.ts` (Express factory, testable) + `index.ts` (server start); fixed circular import between `routes/api.ts` and `index.ts` via `tunnelInstance.ts` singleton

### Tests — relay-server (Jest + supertest) — **23/23 passing**
- `src/test/setup.ts` — env var bootstrap for test suite
- `src/test/auth.test.ts` — login (correct creds, wrong password, wrong username, missing body), refresh (valid, invalid), logout + token invalidation
- `src/test/api.test.ts` — health check, protected routes (401 without token), status, power endpoints (503 when agent offline), app launch (400 missing name, 503 offline), sysinfo (503 offline)
- `src/test/middleware.test.ts` — no header, malformed header, expired token, wrong-secret token, valid token

---

## Session 4 — 2026-03-16 (Ollama + Base Functionalities)

### Completed

**scripts/install-ollama.ps1** — run via SSH, installs Ollama via winget, sets `OLLAMA_HOST=0.0.0.0:11434`, registers as Windows Service via NSSM, pulls llama3.2:3b + codellama:7b + mistral:7b, adds firewall rule

**pc-agent — new services:**
- `src/services/ollamaService.ts` — streams Ollama `/api/chat` responses over fetch, token-by-token, cancellable via AbortController
- `src/services/sysinfoService.ts` — CPU usage (sampled), RAM, disk info (wmic), top processes (tasklist)
- `src/index.ts` updated — handles `ollama.chat`, `ollama.models`, `ollama.cancel`, `sysinfo.get`; pushes sysinfo every 10s automatically

**relay-server — updated:**
- `tunnel/tunnelService.ts` — new `/ollama` WebSocket endpoint, routes streaming tokens to browser, caches sysinfo pushes, added `requestFromAgent()` for REST↔WebSocket bridging
- `routes/api.ts` — `GET /api/sysinfo` returns cached sysinfo or requests on-demand
- `src/types/sysinfo.ts` — shared type

**web-client — new/updated:**
- `services/sysinfo.ts` — HTTP service for sysinfo polling
- `services/ollama-ws.ts` — WebSocket service wrapping Ollama streaming
- `pages/ai-chat/` — full chat UI: streaming responses, model selector, stop button, clear, keyboard shortcut (Enter to send)
- `pages/dashboard/` — updated with CPU/RAM/disk progress bars, uptime, top processes table, "Local AI" quick access button
- `/ai` route added
- FormsModule + MatProgressBarModule + MatSelectModule added to app module

**scripts/deploy-agent.sh** — updated to use `D:` drive, copies both setup scripts, `--ollama` flag to also run Ollama install

**Both `ng build` and `tsc --noEmit` pass cleanly.**

---

## Session 3 — 2026-03-16 (Quickstart + BIOS Guide)

### Completed
- [x] `quickstart.sh` — single-command local startup script (auto-installs deps, starts relay + wol-agent + Angular dev server, Ctrl+C kills all)
- [x] `quickstart.md` — documentation for the quickstart script
- [x] `bios-z390-gaming-x.md` — board-specific BIOS guide for Gigabyte Z390 Gaming X F7 (exact menu paths, ErP setting, I219-V S5 limitation explained, workarounds)
- [x] `pc-setup-manual.md` updated — Section 1 now points to the board-specific BIOS guide

---

## Session 1 — 2026-03-16 (Planning)

### Completed
- [x] `planning.md` — full architecture plan, tech stack, service descriptions, implementation phases
- [x] `implemented.md` — this file, progress tracking
- [x] `context.md` — persistent context injected into future prompts

---

## Session 2 — 2026-03-16 (Phase 1 + Phase 2 Implementation)

### Completed

**Documentation**
- [x] Updated `planning.md` and `context.md`: React → Angular
- [x] `pc-setup-manual.md` — full step-by-step Windows 11 setup guide (BIOS WoL, OpenSSH, Node.js install, NSSM service, Cloudflare Tunnel, router static DHCP)

**relay-server/** (Node.js + Express + ws — runs on VPS)
- [x] `package.json` + `tsconfig.json`
- [x] `src/index.ts` — Express server + WebSocket server bootstrap
- [x] `src/middleware/auth.ts` — JWT Bearer token middleware
- [x] `src/routes/auth.ts` — POST /auth/login, /auth/refresh, /auth/logout
- [x] `src/routes/api.ts` — GET /api/status, POST /api/power/wake|sleep|shutdown|restart, POST /api/apps/launch
- [x] `src/tunnel/tunnelService.ts` — WebSocket relay (agent ↔ relay ↔ browser), routes terminal sessions
- [x] `.env.example`
- [x] TypeScript type-checks cleanly

**pc-agent/** (Node.js — runs on Windows 11 PC)
- [x] `package.json` + `tsconfig.json`
- [x] `src/index.ts` — connects outbound to relay, dispatches messages to services
- [x] `src/services/terminalService.ts` — node-pty sessions (PowerShell/cmd)
- [x] `src/services/powerService.ts` — sleep, shutdown, restart via Windows commands
- [x] `src/services/appService.ts` — whitelisted app launcher from `apps.config.json`
- [x] `apps.config.json` — default apps: notepad, claude, explorer
- [x] `.env.example`

**wol-agent/** (Python Flask — runs on always-on LAN device)
- [x] `server.py` — Flask HTTP server, POST /wake sends UDP magic packet, GET /health
- [x] `requirements.txt`
- [x] `.env.example`

**web-client/** (Angular 19 + Angular Material + xterm.js)
- [x] Scaffolded with Angular CLI (ng new)
- [x] Installed: `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`, `@angular/material`, `@angular/cdk`, `@angular/animations`
- [x] `src/environments/environment.ts` + `environment.prod.ts`
- [x] `src/app/interceptors/auth.interceptor.ts` — JWT attach + 401 auto-refresh
- [x] `src/app/services/auth.ts` — login, logout, token storage, refresh
- [x] `src/app/services/api.ts` — status, wake, sleep, shutdown, restart, launchApp
- [x] `src/app/services/terminal-ws.ts` — WebSocket service wrapping xterm.js comms
- [x] `src/app/guards/auth-guard.ts` — route guard redirects to /login if unauthenticated
- [x] `src/app/pages/login/` — login form with Angular Material
- [x] `src/app/pages/dashboard/` — PC status, power controls (wake/sleep/restart/shutdown), terminal link
- [x] `src/app/pages/terminal/` — full xterm.js terminal with FitAddon + WebLinksAddon
- [x] `src/app/app-module.ts` — all modules + interceptor registered
- [x] `src/app/app-routing-module.ts` — routes with auth guard
- [x] Dark theme global styles
- [x] **Build passes**: `ng build` generates `dist/web-client` successfully

---

## Implementation Status by Phase

| Phase | Status | Notes |
|---|---|---|
| Phase 1 — Foundation (monorepo, relay, agent, auth) | ✅ Complete | |
| Phase 2 — Terminal (xterm.js + node-pty + WebSocket) | ✅ Complete | |
| Phase 3 — Power Management (WoL, sleep, shutdown) | ✅ Complete | WoL via wol-agent; sleep/shutdown via pc-agent |
| Phase 4 — App Launcher | ✅ Complete | JSON config, REST endpoint (UI pending) |
| Phase 5 — Claude Code Bridge | Not started | |
| Phase 6 — PWA + Polish | Not started | |

---

## File / Directory Structure (Current)

```
remote-pc-access/
├── relay-server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   └── src/
│       ├── index.ts
│       ├── middleware/auth.ts
│       ├── routes/auth.ts
│       ├── routes/api.ts
│       └── tunnel/tunnelService.ts
│
├── pc-agent/
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   ├── apps.config.json
│   └── src/
│       ├── index.ts
│       └── services/
│           ├── terminalService.ts
│           ├── powerService.ts
│           └── appService.ts
│
├── wol-agent/
│   ├── server.py
│   ├── requirements.txt
│   └── .env.example
│
├── web-client/                   (Angular 19 + Material + xterm.js)
│   ├── angular.json
│   ├── package.json
│   └── src/
│       ├── environments/
│       │   ├── environment.ts
│       │   └── environment.prod.ts
│       ├── styles.scss
│       └── app/
│           ├── app.ts / app.html
│           ├── app-module.ts
│           ├── app-routing-module.ts
│           ├── interceptors/auth.interceptor.ts
│           ├── guards/auth-guard.ts
│           ├── services/
│           │   ├── auth.ts
│           │   ├── api.ts
│           │   └── terminal-ws.ts
│           └── pages/
│               ├── login/
│               ├── dashboard/
│               └── terminal/
│
├── planning.md        ✅
├── implemented.md     ✅
├── context.md         ✅
└── pc-setup-manual.md ✅
```

## Next Session — What to Implement

- Phase 5: Claude Code bridge (pc-agent claude-bridge service + Angular chat UI)
- Phase 6: PWA manifest + service worker
- App Launcher UI page in Angular (currently only REST endpoint exists)
- `.gitignore` for the project
- `docker-compose.yml` for relay server deployment

<!-- New sessions append above this line -->
