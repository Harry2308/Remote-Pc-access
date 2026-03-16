# Update & Restart — Deploy pc-agent and Relaunch Stack

Deploy the latest code to the Windows PC and restart everything with one command:

```bash
bash scripts/update-and-restart.sh
```

Run this from the repo root (`~/Desktop/Remote-Pc-access`). Enter your Windows password once when prompted.

---

## What the script does

1. **Connects** to the Windows PC over SSH (one password prompt)
2. **Stops** the `RemotePCAgent` Windows service
3. **Copies** the updated `pc-agent` source files to `D:\remote-pc-access\pc-agent\`
4. **Builds** the pc-agent on the PC (`npm install` + `npm run build`)
5. **Starts** the `RemotePCAgent` service again
6. **Rebuilds** the relay-server TypeScript locally
7. **Kills** any leftover local stack processes
8. **Starts** relay-server + wol-agent in the background
9. **Opens** the Angular dev server and launches your browser at http://localhost:4200

Press **Ctrl+C** to stop the local services.

---

## When to run this

| Situation | Command |
|---|---|
| You changed any pc-agent code | `bash scripts/update-and-restart.sh` |
| You changed relay-server code | `bash scripts/update-and-restart.sh` |
| First time setting up after a new session | `bash scripts/update-and-restart.sh` |
| Just restarting the local stack (no PC changes) | `./quickstart.sh` |

---

## Prerequisites

- SSH access to the Windows PC (`unger@192.168.0.137`)
- `RemotePCAgent` service already registered on the PC (done by `deploy-agent.sh`)
- `node`, `npm`, `python3` installed on this laptop

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Password prompt fails / hangs | Make sure `ssh unger@192.168.0.137` works manually first |
| Service won't start | SSH in and run `type D:\remote-pc-access\pc-agent\service-error.log` |
| Build fails on PC | SSH in and run `cd D:\remote-pc-access\pc-agent && npm run build` manually |
| Port already in use | `lsof -i :3001` or `lsof -i :4200` then `kill <PID>` |
| Logs | `.logs/relay-server.log`, `.logs/wol-agent.log` |
