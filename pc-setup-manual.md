# PC Setup Manual — Windows 11 Home

> This file documents every step you need to perform on your **Windows 11 PC** to make the remote access system work.
> Steps are ordered by dependency. Read each section fully before executing.
> Updated after every implementation session.

## Automated Setup (recommended)

SSH and WoL are working. **Steps 3–8 below are now handled automatically** by running one command from your laptop:

```bash
./scripts/deploy-agent.sh
```

This script:
1. Copies `pc-agent/` to `C:\remote-pc-access\` on the PC via SCP
2. SSHs in and runs `scripts/setup-windows.ps1` which installs Node.js, Python, Git, NSSM, compiles node-pty, builds the agent, and registers it as a Windows Service

After it finishes, you only need to edit `.env` on the PC and start the service (instructions printed at the end).

---

---

## Table of Contents
1. [BIOS — Enable Wake-on-LAN](#1-bios--enable-wake-on-lan)
2. [Windows — Network Adapter WoL Settings](#2-windows--network-adapter-wol-settings)
3. [Windows — Install OpenSSH Server (optional but recommended)](#3-windows--install-openssh-server)
4. [Windows — Install Node.js](#4-windows--install-nodejs)
5. [Windows — Install Python (for WoL agent)](#5-windows--install-python-for-wol-agent)
6. [Windows — Clone this Repository](#6-windows--clone-this-repository)
7. [Windows — Configure and Run the PC Agent](#7-windows--configure-and-run-the-pc-agent)
8. [Windows — Install PC Agent as a Windows Service](#8-windows--install-pc-agent-as-a-windows-service)
9. [Router — Static DHCP Lease for PC](#9-router--static-dhcp-lease-for-pc)
10. [Cloudflare Tunnel Setup](#10-cloudflare-tunnel-setup)
11. [Finding Your PC's MAC Address](#11-finding-your-pcs-mac-address)

---

## 1. BIOS — Enable Wake-on-LAN

> **You have a Gigabyte Z390 Gaming X (F7).** See **`bios-z390-gaming-x.md`** for the exact steps specific to your board.
> The generic steps below are for reference only.

**Generic steps:**
1. Restart your PC and enter BIOS (press `Del` during POST on your board)
2. Navigate to `Settings` → `Platform Power`
3. Set `ErP` → **Disabled** ← most important
4. Set `Power On By PCI-E` → **Enabled** *(may not exist on your board — skip if not present)*
5. Save and exit (`F10`)

> **Hint:** If you have an ASUS board look in `Advanced > APM Configuration`. For MSI, look in `Settings > Advanced > Wake Up Event Setup`. For Gigabyte, look in `Settings > Platform Power`.

> **Important:** WoL from full shutdown **requires the PC to remain connected to power and ethernet**. Unplugging the power cable resets the WoL state on some boards.

---

## 2. Windows — Network Adapter WoL Settings

> Required so Windows doesn't shut off the network card completely when sleeping/off.

**Steps:**
1. Press `Win + X` → **Device Manager**
2. Expand **Network Adapters**
3. Right-click your **ethernet adapter** (e.g., "Intel(R) Ethernet Connection") → **Properties**
4. Go to the **Power Management** tab:
   - Check ✅ `Allow this device to wake the computer`
   - Check ✅ `Only allow a magic packet to wake the computer`
5. Go to the **Advanced** tab:
   - Find `Wake on Magic Packet` → set to **Enabled**
   - Find `Wake on Pattern Match` → set to **Disabled** (reduces false wakes)
   - Find `Energy Efficient Ethernet` → set to **Disabled** (can interfere with WoL)
6. Click OK

> **Hint:** WoL only works reliably over **ethernet (cable)**. WiFi does not support standard WoL magic packets.

---

## 3. Windows — Install OpenSSH Server

> Optional but provides a fallback terminal access method independent of the PC agent.

**Steps:**
1. Press `Win + I` → **System** → **Optional Features**
2. Click **Add a feature**
3. Search for `OpenSSH Server` → Install
4. After install, press `Win + R` → type `services.msc` → Enter
5. Find **OpenSSH SSH Server** → right-click → **Properties**
6. Set **Startup type** to `Automatic` → click **Start** → OK
7. Windows firewall rule is added automatically (port 22 TCP)

**Test it (from this laptop):**
```bash
# Replace with your PC's local IP
`ssh unger@192.168.0.137
````

```bash
```wakeonlan b4:2e:99:4c:35:8f
``````

```bash
wakeonlan b4:2e:99:4c:35:8f && sleep 30 && ssh unger@192.168.0.137
``` 

```bash
shutdown /s /t 0 && exit
```

---

## 4. Windows — Install Node.js

> Required to run the `pc-agent`.

**Steps:**
1. Go to [https://nodejs.org](https://nodejs.org) → download the **LTS** installer (v20 or later)
2. Run the installer — accept defaults, make sure **"Add to PATH"** is checked
3. On the "Tools for Native Modules" screen: **check the checkbox** to install build tools (needed for `node-pty`)
4. Restart the PC after install
5. Verify in PowerShell: `node --version` and `npm --version`

> **Hint:** The build tools step installs Visual Studio Build Tools and Python automatically. This is required for `node-pty` to compile its native Windows bindings.

---

## 5. Windows — Install Python (for WoL agent)

> Only needed if the WoL agent runs on the Windows PC. Skip if using a Raspberry Pi or other device.

**Steps:**
1. Go to [https://python.org](https://python.org) → download Python 3.11 or later
2. Run installer — **check "Add Python to PATH"** at the bottom of the first screen
3. Verify in PowerShell: `python --version`

---

## 6. Windows — Clone this Repository

**Steps:**
1. Install Git if not already installed: [https://git-scm.com/download/win](https://git-scm.com/download/win)
2. Open PowerShell and run:
```powershell
cd C:\
mkdir Projects
cd Projects
git clone <your-repo-url> remote-pc-access
cd remote-pc-access
```

> **Alternative:** Copy the project files manually via USB or network share if you don't have git set up yet.

---

## 7. Windows — Configure and Run the PC Agent

**Steps:**
1. Open PowerShell in the project directory:
```powershell
cd C:\Projects\remote-pc-access\pc-agent
```
2. Copy the environment template:
```powershell
copy .env.example .env
```
3. Edit `.env` with Notepad:
```powershell
notepad .env
```
Fill in:
- `RELAY_URL` — the WebSocket URL of your relay server (e.g., `wss://your-relay.com`)
- `AGENT_SECRET` — a long random string (shared secret between relay and agent)
- `ALLOWED_SHELL` — `powershell` (default) or `cmd`

4. Install dependencies:
```powershell
npm install
```
> **Note:** This will compile `node-pty` native bindings. Requires Build Tools from step 4. May take 2-3 minutes.

5. Build and run:
```powershell
npm run build
npm start
```
You should see: `PC Agent connected to relay`

---

## 8. Windows — Install PC Agent as a Windows Service

> So the agent starts automatically on boot without needing to log in.

**Using NSSM (Non-Sucking Service Manager):**
1. Download NSSM: [https://nssm.cc/download](https://nssm.cc/download)
2. Extract and copy `nssm.exe` to `C:\Windows\System32\`
3. Open PowerShell **as Administrator** and run:
```powershell
nssm install RemotePCAgent
```
4. In the NSSM GUI that opens:
   - **Path:** `C:\Program Files\nodejs\node.exe`
   - **Startup directory:** `C:\Projects\remote-pc-access\pc-agent`
   - **Arguments:** `dist/index.js`
5. Go to the **Environment** tab and add your `.env` variables
6. Click **Install service**
7. Start it: `nssm start RemotePCAgent`

**To check logs:**
```powershell
nssm status RemotePCAgent
Get-EventLog -LogName Application -Source RemotePCAgent -Newest 20
```

---

## 9. Router — Static DHCP Lease for PC

> Ensures your PC always gets the same IP address on the LAN, required for reliable WoL.

**Steps:**
1. Find your PC's MAC address (see [Section 11](#11-finding-your-pcs-mac-address))
2. Log into your router admin panel (usually `192.168.1.1` or `192.168.0.1`)
3. Find **DHCP Reservations**, **Static Leases**, or **Address Reservation**
4. Add a reservation: MAC address → fixed IP (e.g., `192.168.1.100`)
5. Save and reboot router

> **Hint:** Write down both the MAC address and the static IP — they are needed in the `wol-agent/.env` file.

---

## 10. Cloudflare Tunnel Setup

> This exposes the relay server (or pc-agent directly) to the internet without opening ports on your router.

### Option A — Relay server is on a VPS (standard setup)
The relay server on your VPS is already public. No Cloudflare Tunnel needed for the relay.
You only need to ensure the VPS has ports 80/443/3001 open.

### Option B — Running everything locally (no VPS)
Use Cloudflare Tunnel to expose the pc-agent directly:

1. Create a free Cloudflare account at [cloudflare.com](https://cloudflare.com)
2. Download `cloudflared` for Windows: [https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
3. In PowerShell:
```powershell
cloudflared tunnel login
cloudflared tunnel create remote-pc
cloudflared tunnel route dns remote-pc remote-pc.yourdomain.com
```
4. Create config file at `C:\Users\YourName\.cloudflared\config.yml`:
```yaml
tunnel: <your-tunnel-id>
credentials-file: C:\Users\YourName\.cloudflared\<tunnel-id>.json
ingress:
  - hostname: remote-pc.yourdomain.com
    service: http://localhost:3002
  - service: http_status:404
```
5. Run: `cloudflared tunnel run remote-pc`
6. Install as service: `cloudflared service install`

---

## 11. Finding Your PC's MAC Address

> Needed for WoL configuration.

**In PowerShell:**
```powershell
Get-NetAdapter | Where-Object {$_.Status -eq "Up"} | Select-Object Name, MacAddress
```

Look for your **ethernet adapter** (not WiFi). The MAC address looks like `A1-B2-C3-D4-E5-F6`.

> Write this MAC address into `wol-agent/.env` as `TARGET_MAC`.

---

## Status Checklist

| Step | Done? | Notes |
|---|---|---|
| BIOS WoL enabled | ☐ | |
| Network adapter WoL settings | ☐ | |
| OpenSSH Server installed | ☐ | |
| Node.js installed (with build tools) | ☐ | |
| Python installed | ☐ | |
| Repository cloned | ☐ | |
| pc-agent `.env` configured | ☐ | |
| pc-agent running | ☐ | |
| pc-agent installed as Windows Service | ☐ | |
| Static DHCP lease configured | ☐ | |
| MAC address noted | ☐ | MAC: `________________` |
| Cloudflare Tunnel / VPS configured | ☐ | |
