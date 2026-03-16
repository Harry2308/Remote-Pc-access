# Quickstart — Run Everything Locally

Start the entire stack with a single command:

```bash
./quickstart.sh
```

That's it. Open your browser at **http://localhost:4200**

---

## What the script does

1. **Checks** that `node`, `npm`, and `python3` are installed
2. **Auto-creates `.env` files** from `.env.example` if they don't exist yet (dev defaults)
3. **Installs npm dependencies** for `relay-server` and `web-client` if `node_modules` is missing
4. **Creates a Python venv** for `wol-agent` and installs Flask if missing
5. **Builds** `relay-server` TypeScript (`dist/`) if not already built
6. **Starts** all three backend services in the background (logs written to `.logs/`)
7. **Opens** the Angular dev server in the foreground and launches your browser

Press **Ctrl+C** to shut down all services cleanly.

---

## Services started

| Service | URL | Log |
|---|---|---|
| relay-server | http://localhost:3001 | `.logs/relay-server.log` |
| wol-agent | http://localhost:3003 | `.logs/wol-agent.log` |
| web-client (Angular) | http://localhost:4200 | terminal output |

---

## Prerequisites (one-time setup on this machine)

| Tool | Install |
|---|---|
| Node.js ≥ 20 | https://nodejs.org |
| Python 3.11+ | https://python.org |
| npm | bundled with Node.js |

---

## First run — edit your `.env` files

The script copies `.env.example` → `.env` automatically on first run.
**For local development the defaults work fine.** The only value you may want to change:

**`relay-server/.env`**
```
ADMIN_USERNAME=admin
ADMIN_PASSWORD=yourpassword    # change this
JWT_SECRET=any-random-string   # change this
AGENT_SECRET=another-random    # change this (must match pc-agent/.env)
```

---

## Notes

- The **pc-agent** is NOT started by this script — it runs on your Windows PC, not this laptop.
  See `pc-setup-manual.md` for how to set it up.
- The **wol-agent** is started but will report `TARGET_MAC not configured` until you fill in the MAC address in `wol-agent/.env`.
- Logs are written to `.logs/` (git-ignored). Tail them with:
  ```bash
  tail -f .logs/relay-server.log
  ```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Port 3001 already in use | `lsof -i :3001` then `kill <PID>` |
| Port 4200 already in use | `lsof -i :4200` then `kill <PID>` |
| `ng: command not found` | Script uses `npx ng serve` — no global install needed |
| Python venv fails | Make sure `python3 -m venv` works: `sudo apt install python3-venv` |
| relay-server won't start | Check `.logs/relay-server.log` — likely missing `.env` values |
