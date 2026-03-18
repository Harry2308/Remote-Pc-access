# setup-windows.ps1
# Run this on the Windows PC via SSH:
#   ssh unger@192.168.0.137 "powershell -ExecutionPolicy Bypass -File D:\remote-pc-access\scripts\setup-windows.ps1"
#
# Flags (passed by run.sh based on hash comparison):
#   -SkipNpmInstall   skip npm install (package.json unchanged)
#   -SkipBuild        skip tsc build   (source unchanged)
param(
    [switch]$SkipNpmInstall,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

function Info    { Write-Host "[setup] $args" -ForegroundColor Cyan }
function Success { Write-Host "[setup] $args" -ForegroundColor Green }
function Warn    { Write-Host "[setup] $args" -ForegroundColor Yellow }
function Err     { Write-Host "[setup] $args" -ForegroundColor Red }

Info "=== Remote PC Access - Windows Setup Script ==="
Info "Running as: $env:USERNAME on $env:COMPUTERNAME"

# Add Defender exclusion so ps1 helper scripts aren't blocked
try {
    Add-MpPreference -ExclusionPath "D:\remote-pc-access" -ErrorAction SilentlyContinue
    Success "Windows Defender exclusion set for D:\remote-pc-access"
} catch { Warn "Could not set Defender exclusion (non-fatal): $_" }

# Helper: refresh PATH in current session after winget installs
function Refresh-Path {
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH", "User")
}

# Helper: check if a command exists
function Test-Command($cmd) {
    return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

# 1. Node.js
Info "Checking Node.js..."
if (Test-Command "node") {
    $nodeVer = node --version
    Success "Node.js already installed: $nodeVer"
} else {
    Info "Installing Node.js LTS via winget..."
    winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    Refresh-Path
    if (Test-Command "node") {
        Success "Node.js installed: $(node --version)"
    } else {
        Err "Node.js install failed - please install manually from https://nodejs.org"
        exit 1
    }
}

# 2. Node.js native build tools (required for node-pty)
Info "Checking Visual Studio Build Tools (required for node-pty)..."
$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasBuildTools = (Test-Path $vsWhere) -and (& $vsWhere -products * -property installationPath 2>$null)
if ($hasBuildTools) {
    Success "Visual Studio Build Tools already present"
} else {
    Info "Installing Visual Studio Build Tools via winget..."
    winget install --id Microsoft.VisualStudio.2022.BuildTools --silent --accept-package-agreements --accept-source-agreements `
        --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
    Success "Build tools setup complete"
}

# 3. Python
Info "Checking Python..."
if (Test-Command "python") {
    $pyVer = python --version
    Success "Python already installed: $pyVer"
} else {
    Info "Installing Python 3.11 via winget..."
    winget install --id Python.Python.3.11 --silent --accept-package-agreements --accept-source-agreements
    Refresh-Path
    if (Test-Command "python") {
        Success "Python installed: $(python --version)"
    } else {
        Err "Python install failed - please install manually from https://python.org"
        exit 1
    }
}

# 4. Git
Info "Checking Git..."
if (Test-Command "git") {
    Success "Git already installed: $(git --version)"
} else {
    Info "Installing Git via winget..."
    winget install --id Git.Git --silent --accept-package-agreements --accept-source-agreements
    Refresh-Path
    Success "Git installed: $(git --version)"
}

# 5. NSSM (service manager)
Info "Checking NSSM..."
if (Test-Command "nssm") {
    Success "NSSM already installed"
} else {
    Info "Downloading NSSM..."
    $nssmZip = "$env:TEMP\nssm.zip"
    $nssmDir = "$env:TEMP\nssm"
    Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $nssmZip -UseBasicParsing
    Expand-Archive -Path $nssmZip -DestinationPath $nssmDir -Force
    $nssmExe = Get-ChildItem -Path $nssmDir -Recurse -Filter "nssm.exe" |
               Where-Object { $_.Directory.Name -eq "win64" } |
               Select-Object -First 1
    Copy-Item $nssmExe.FullName -Destination "C:\Windows\System32\nssm.exe"
    Remove-Item $nssmZip, $nssmDir -Recurse -Force
    Success "NSSM installed to System32"
}

# 6. Install pc-agent npm dependencies
$agentDir = "D:\remote-pc-access\pc-agent"
if (Test-Path "$agentDir\package.json") {
    $needsInstall = (-not $SkipNpmInstall) -or (-not (Test-Path "$agentDir\node_modules"))
    if ($needsInstall) {
        Info "Installing pc-agent npm dependencies (compiles node-pty - may take 2-3 min)..."
        Push-Location $agentDir
        npm install
        if ($LASTEXITCODE -ne 0) {
            Err "npm install failed in pc-agent"
            Pop-Location
            exit 1
        }
        Pop-Location
        Success "pc-agent dependencies installed"
    } else {
        Success "pc-agent dependencies unchanged - skipping npm install"
    }
} else {
    Warn "pc-agent not found at $agentDir - skipping npm install"
    Warn "Copy the pc-agent folder to D:\remote-pc-access\pc-agent and re-run this script"
}

# 7. Build pc-agent TypeScript
if (Test-Path "$agentDir\package.json") {
    $needsBuild = (-not $SkipBuild) -or (-not (Test-Path "$agentDir\dist\index.js"))
    if ($needsBuild) {
        Info "Building pc-agent TypeScript..."
        Push-Location $agentDir
        npm run build
        Pop-Location
        Success "pc-agent built successfully"
    } else {
        Success "pc-agent source unchanged - skipping tsc build"
    }
}

# 8. Create .env from .env.example if not present
if (Test-Path "$agentDir\.env.example") {
    if (-not (Test-Path "$agentDir\.env")) {
        Copy-Item "$agentDir\.env.example" "$agentDir\.env"
        Warn ".env created from .env.example - EDIT IT before starting the agent:"
        Warn "  notepad $agentDir\.env"
    } else {
        Success ".env already exists"
    }
}

# 9. Enable RDP (Remote Desktop) - required for remote interactive sessions
Info "Enabling Remote Desktop..."
reg add "HKLM\System\CurrentControlSet\Control\Terminal Server" /v fDenyTSConnections /t REG_DWORD /d 0 /f | Out-Null
netsh advfirewall firewall add rule name="RDP-In" protocol=TCP dir=in localport=3389 action=allow | Out-Null
net stop TermService /y | Out-Null
net start TermService | Out-Null
Success "RDP enabled and TermService restarted (port 3389)"

# 10. Install and configure TightVNC server (free, open-source, works on Windows Home)
Info "Setting up TightVNC server..."

# Read VNC_PASSWORD from pc-agent .env (written by run.sh before this script runs)
$envFile = 'D:\remote-pc-access\pc-agent\.env'
$vncPassword = ''
if (Test-Path $envFile) {
    $vncLine = Get-Content $envFile | Where-Object { $_ -match '^VNC_PASSWORD=' }
    if ($vncLine) { $vncPassword = ($vncLine -replace '^VNC_PASSWORD=', '').Trim() }
}

$tvnExe = 'C:\Program Files\TightVNC\tvnserver.exe'

if (-not (Test-Path $tvnExe)) {
    Info "Installing TightVNC via winget..."
    winget install --id GlavSoft.TightVNC --silent --accept-package-agreements --accept-source-agreements
    Start-Sleep -Seconds 5
    if (Test-Path $tvnExe) { Success "TightVNC installed" } else { Warn "tvnserver.exe not found after install" }
} else {
    Success "TightVNC already installed"
}

# Encode VNC password using standard VNC DES obfuscation (RFB protocol, same for TightVNC)
function ConvertTo-VNCPasswordBytes {
    param([string]$PlainText)
    function Reverse-Bits {
        param([byte]$b)
        [byte]$r = 0
        for ($i = 0; $i -lt 8; $i++) {
            $r = [byte](($r -shl 1) -bor ($b -band 1))
            $b = [byte]($b -shr 1)
        }
        return $r
    }
    $rawKey = [byte[]]@(0x17, 0x52, 0x6B, 0x06, 0x23, 0x4E, 0x58, 0x07)
    $desKey = $rawKey | ForEach-Object { Reverse-Bits $_ }
    $pwdBytes = [byte[]]::new(8)
    $maxLen = [Math]::Min($PlainText.Length, 8)
    $src = [System.Text.Encoding]::ASCII.GetBytes($PlainText.Substring(0, $maxLen))
    [Array]::Copy($src, $pwdBytes, $src.Length)
    $des = [System.Security.Cryptography.DES]::Create()
    $des.Mode = [System.Security.Cryptography.CipherMode]::ECB
    $des.Padding = [System.Security.Cryptography.PaddingMode]::None
    $des.Key = $desKey
    return $des.CreateEncryptor().TransformFinalBlock($pwdBytes, 0, 8)
}

# Write TightVNC registry config under HKLM (applies to the service, not per-user)
$regPath = 'HKLM:\SOFTWARE\TightVNC\Server'
try {
    $null = New-Item -Path $regPath -Force -ErrorAction Stop
    Set-ItemProperty -Path $regPath -Name 'UseVncAuthentication' -Value 1 -Type DWord
    Set-ItemProperty -Path $regPath -Name 'QueryConnect'         -Value 0 -Type DWord
    Set-ItemProperty -Path $regPath -Name 'DisconnectClients'    -Value 1 -Type DWord
    if ($vncPassword.Length -ge 1) {
        $encrypted = ConvertTo-VNCPasswordBytes $vncPassword
        Set-ItemProperty -Path $regPath -Name 'Password'        -Value $encrypted -Type Binary
        Set-ItemProperty -Path $regPath -Name 'ControlPassword' -Value $encrypted -Type Binary
        Info "VNC password written to registry"
    } else {
        Warn "VNC_PASSWORD empty - set VNC_PASSWORD in relay-server/.env and re-run"
    }
    Success "TightVNC registry configured"
} catch {
    Warn "TightVNC registry write failed: $($_.Exception.Message)"
}

# Register TightVNC as a Windows service and start it
if (Test-Path $tvnExe) {
    $svc = Get-Service -Name tvnserver -ErrorAction SilentlyContinue
    if (-not $svc) {
        Info "Registering TightVNC service..."
        & $tvnExe -install -silent
        Start-Sleep -Seconds 3
    }
    Stop-Service  -Name tvnserver -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    Start-Service -Name tvnserver        -ErrorAction SilentlyContinue
    $svcState = (Get-Service -Name tvnserver -ErrorAction SilentlyContinue).Status
    if ($svcState -eq 'Running') {
        Success "TightVNC service running on port 5900"
    } else {
        Warn "TightVNC service state: $svcState"
    }
} else {
    Warn "tvnserver.exe not found - skipping service setup"
}

# Open VNC port in Windows Firewall
netsh advfirewall firewall add rule name="VNC-In" protocol=TCP dir=in localport=5900 action=allow | Out-Null
Success "VNC firewall rule added (port 5900)"

# 11. Remove legacy NSSM service if present (migrating to Scheduled Task)
$taskName    = "RemotePCAgent"
$nssmExe     = "C:\Windows\System32\nssm.exe"
$nodeCmd     = Get-Command node -ErrorAction SilentlyContinue
$nodeExe     = if ($nodeCmd) { $nodeCmd.Source } else { $null }
$agentScript = "$agentDir\dist\index.js"

$legacyService = Get-Service -Name $taskName -ErrorAction SilentlyContinue
if ($legacyService -and (Test-Path $nssmExe)) {
    Info "Removing legacy NSSM service (switching to Scheduled Task for interactive desktop access)..."
    $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    & $nssmExe stop $taskName confirm 2>$null | Out-Null
    Start-Sleep -Seconds 1
    & $nssmExe remove $taskName confirm 2>$null | Out-Null
    $ErrorActionPreference = $prev
    Success "NSSM service removed"
}

# 10. Register/update as Scheduled Task (interactive session = full desktop access for screen capture)
if ($nodeExe -and (Test-Path $agentScript)) {
    Info "Registering '$taskName' as Scheduled Task (interactive session)..."
    # Use a .bat wrapper to avoid cmd.exe /c quoting bug (multiple quoted args after /c are mishandled)
    $logFile   = "$agentDir\service.log"
    $batFile   = "$agentDir\start-agent.bat"
    $batLines  = "@echo off", "cd /d `"$agentDir`"", "`"$nodeExe`" `"$agentScript`" >> `"$logFile`" 2>&1"
    Set-Content -Path $batFile -Value ($batLines -join "`r`n") -Encoding ASCII
    Info "Created start-agent.bat"
    $action    = New-ScheduledTaskAction `
                    -Execute "cmd.exe" `
                    -Argument "/c `"$batFile`"" `
                    -WorkingDirectory $agentDir
    $trigger   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $settings  = New-ScheduledTaskSettingsSet `
                    -ExecutionTimeLimit 0 `
                    -RestartCount 5 `
                    -RestartInterval (New-TimeSpan -Minutes 1) `
                    -StartWhenAvailable `
                    -MultipleInstances IgnoreNew
    # RunLevel Limited (not Highest) - runs in user's normal window station (WinSta0\Default).
    # Elevated tasks get a separate window station which breaks GDI screen capture.
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal -Force | Out-Null
    Success "Task '$taskName' registered (runs at logon in interactive session)"
    Info "To start manually:  Start-ScheduledTask -TaskName '$taskName'"
    Info "To check status:    (Get-ScheduledTask -TaskName '$taskName').State"
    Info "To view logs:       type $agentDir\service.log"
} else {
    Warn "node.exe or dist/index.js not found - task not registered"
}

# Done
Info ""
Info "=== Setup complete ==="
Info "Next steps:"
Info "  1. Edit $agentDir\.env  (set RELAY_URL and AGENT_SECRET)"
Info "  2. Log into Windows (physically or via RDP) - the task starts automatically at logon"
Info "  3. Or start manually: Start-ScheduledTask -TaskName '$taskName'"
Info "  4. Check .logs/relay-server.log on your laptop to confirm agent connected"
