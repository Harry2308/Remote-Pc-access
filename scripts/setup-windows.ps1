# setup-windows.ps1
# Run this on the Windows PC via SSH:
#   ssh unger@192.168.0.137 "powershell -ExecutionPolicy Bypass -File D:\remote-pc-access\scripts\setup-windows.ps1"
#
# Or paste directly into the SSH PowerShell session.

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
    Warn "pc-agent not found at $agentDir - skipping npm install"
    Warn "Copy the pc-agent folder to D:\remote-pc-access\pc-agent and re-run this script"
}

# 7. Build pc-agent TypeScript
if (Test-Path "$agentDir\package.json") {
    Info "Building pc-agent TypeScript..."
    Push-Location $agentDir
    npm run build
    Pop-Location
    Success "pc-agent built successfully"
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

# 9. Install pc-agent as Windows Service via NSSM
$serviceName = "RemotePCAgent"
$nodeExe     = (Get-Command node).Source
$agentScript = "$agentDir\dist\index.js"

if (Test-Path $agentScript) {
    $existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($existingService) {
        Warn "Service '$serviceName' already exists - stopping and removing to reinstall..."
        $prev = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        nssm stop $serviceName 2>$null | Out-Null
        nssm remove $serviceName confirm 2>$null | Out-Null
        $ErrorActionPreference = $prev
    }

    Info "Registering '$serviceName' Windows Service..."
    nssm install $serviceName $nodeExe $agentScript
    nssm set $serviceName AppDirectory $agentDir
    nssm set $serviceName DisplayName "Remote PC Access Agent"
    nssm set $serviceName Description "Connects to relay server and handles terminal/power/app commands"
    nssm set $serviceName Start SERVICE_AUTO_START
    nssm set $serviceName AppStdout "$agentDir\service.log"
    nssm set $serviceName AppStderr "$agentDir\service-error.log"

    # Pass .env variables to the service environment
    if (Test-Path "$agentDir\.env") {
        $envVars = Get-Content "$agentDir\.env" |
                   Where-Object { $_ -match "^[A-Z_]+=.+" -and $_ -notmatch "^#" } |
                   ForEach-Object { $_ -replace '"', '' }
        foreach ($var in $envVars) {
            $key, $val = $var -split "=", 2
            nssm set $serviceName AppEnvironmentExtra "$key=$val"
        }
    }

    Success "Service '$serviceName' registered"
    Warn "IMPORTANT: Edit $agentDir\.env with your relay URL and secrets before starting the service"
    Info "To start the service after editing .env:"
    Info "  nssm start $serviceName"
    Info "To check service status:"
    Info "  nssm status $serviceName"
    Info "To view logs:"
    Info "  type $agentDir\service.log"
} else {
    Warn "pc-agent dist not found - service not registered yet"
    Warn "After copying files and running npm run build, re-run this script to register the service"
}

# Done
Info ""
Info "=== Setup complete ==="
Info "Next steps:"
Info "  1. Edit $agentDir\.env  (set RELAY_URL and AGENT_SECRET)"
Info "  2. nssm start $serviceName"
Info "  3. Check .logs/relay-server.log on your laptop to confirm agent connected"
