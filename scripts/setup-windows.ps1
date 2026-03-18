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

# 9. Remove legacy NSSM service if present (migrating to Scheduled Task)
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
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
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
