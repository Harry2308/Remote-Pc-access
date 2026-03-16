# install-ollama.ps1
# Installs Ollama on Windows, pulls default models, and registers it as a Windows Service
# so it starts automatically and is accessible to the pc-agent.
#
# Run via SSH from laptop:
#   ssh unger@192.168.0.137 "powershell -ExecutionPolicy Bypass -File D:\remote-pc-access\scripts\install-ollama.ps1"

$ErrorActionPreference = "Stop"

function Info    { Write-Host "[ollama] $args" -ForegroundColor Cyan }
function Success { Write-Host "[ollama] $args" -ForegroundColor Green }
function Warn    { Write-Host "[ollama] $args" -ForegroundColor Yellow }
function Err     { Write-Host "[ollama] $args" -ForegroundColor Red }

function Refresh-Path {
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH","User")
}

function Test-Command($cmd) {
    return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

Info "=== Ollama Setup for Remote PC Access ==="

# ─── 1. Install Ollama ────────────────────────────────────────────────────────
Info "Checking Ollama..."
if (Test-Command "ollama") {
    Success "Ollama already installed: $(ollama --version)"
} else {
    Info "Installing Ollama via winget..."
    winget install --id Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements
    Refresh-Path
    # winget installs to AppData by default — check common paths
    $ollamaPaths = @(
        "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
        "$env:ProgramFiles\Ollama\ollama.exe"
    )
    foreach ($p in $ollamaPaths) {
        if (Test-Path $p) {
            $dir = Split-Path $p
            if ($env:PATH -notlike "*$dir*") {
                [System.Environment]::SetEnvironmentVariable("PATH", "$env:PATH;$dir", "User")
                $env:PATH += ";$dir"
            }
            break
        }
    }
    Refresh-Path
    if (Test-Command "ollama") {
        Success "Ollama installed: $(ollama --version)"
    } else {
        Err "Ollama not found in PATH after install."
        Err "Try logging out and back in, then re-run this script."
        Err "Or install manually from https://ollama.com/download"
        exit 1
    }
}

# ─── 2. Configure Ollama to listen on all interfaces ─────────────────────────
# By default Ollama binds to 127.0.0.1 only. We need it on 0.0.0.0 so the
# pc-agent (running as a service) can reach it, and optionally for LAN access.
Info "Configuring Ollama to bind on all interfaces..."
[System.Environment]::SetEnvironmentVariable("OLLAMA_HOST", "0.0.0.0:11434", "Machine")
$env:OLLAMA_HOST = "0.0.0.0:11434"

# Allow longer context window
[System.Environment]::SetEnvironmentVariable("OLLAMA_NUM_CTX", "8192", "Machine")

Success "OLLAMA_HOST set to 0.0.0.0:11434"

# ─── 3. Register Ollama as a Windows Service via NSSM ────────────────────────
$serviceName = "OllamaService"

# Find ollama.exe
$ollamaExe = (Get-Command ollama -ErrorAction SilentlyContinue)?.Source
if (-not $ollamaExe) {
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
        "$env:ProgramFiles\Ollama\ollama.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { $ollamaExe = $c; break }
    }
}

if (-not $ollamaExe) {
    Err "Cannot locate ollama.exe — cannot register service"
    exit 1
}

Info "Registering Ollama as Windows Service ($serviceName)..."
$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existing) {
    Warn "Service already exists — removing to reinstall..."
    nssm stop $serviceName 2>$null
    nssm remove $serviceName confirm 2>$null
}

nssm install $serviceName $ollamaExe "serve"
nssm set $serviceName AppDirectory (Split-Path $ollamaExe)
nssm set $serviceName DisplayName "Ollama LLM Server"
nssm set $serviceName Description "Runs Ollama local LLM server, used by Remote PC Access"
nssm set $serviceName Start SERVICE_AUTO_START
nssm set $serviceName AppStdout "$env:LOCALAPPDATA\ollama\service.log"
nssm set $serviceName AppStderr "$env:LOCALAPPDATA\ollama\service-error.log"
nssm set $serviceName AppEnvironmentExtra "OLLAMA_HOST=0.0.0.0:11434" "OLLAMA_NUM_CTX=8192"

Info "Starting Ollama service..."
nssm start $serviceName
Start-Sleep -Seconds 3

$svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Success "Ollama service running"
} else {
    Warn "Service may not have started — check: nssm status $serviceName"
}

# ─── 4. Pull models ───────────────────────────────────────────────────────────
Info ""
Info "Pulling AI models (this downloads large files — may take a while)..."
Info "Models stored in: $env:USERPROFILE\.ollama\models"
Info ""

# Wait for Ollama to be ready
$retries = 10
for ($i = 0; $i -lt $retries; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -UseBasicParsing -TimeoutSec 3
        if ($resp.StatusCode -eq 200) { break }
    } catch {}
    Info "Waiting for Ollama to be ready... ($($i+1)/$retries)"
    Start-Sleep -Seconds 2
}

# Pull models — change this list to add/remove models
$models = @(
    @{ name = "llama3.2:3b";    desc = "Llama 3.2 3B — fast, general purpose (~2GB)" },
    @{ name = "codellama:7b";   desc = "CodeLlama 7B — code generation and review (~4GB)" },
    @{ name = "mistral:7b";     desc = "Mistral 7B — strong reasoning (~4GB)" }
)

foreach ($model in $models) {
    Info "Pulling $($model.name) — $($model.desc)"
    $response = Invoke-WebRequest -Uri "http://localhost:11434/api/pull" `
        -Method POST `
        -Body "{`"name`": `"$($model.name)`", `"stream`": false}" `
        -ContentType "application/json" `
        -UseBasicParsing `
        -TimeoutSec 600
    if ($response.StatusCode -eq 200) {
        Success "$($model.name) ready"
    } else {
        Warn "Pull may have failed for $($model.name) — check manually: ollama pull $($model.name)"
    }
}

# ─── 5. Windows Firewall rule for local LAN access ───────────────────────────
Info "Adding Windows Firewall rule for Ollama (port 11434)..."
$ruleName = "Ollama LLM Server"
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if (-not $existing) {
    New-NetFirewallRule -DisplayName $ruleName `
        -Direction Inbound `
        -Protocol TCP `
        -LocalPort 11434 `
        -Action Allow `
        -Profile Private | Out-Null
    Success "Firewall rule added"
} else {
    Success "Firewall rule already exists"
}

# ─── Done ─────────────────────────────────────────────────────────────────────
Info ""
Info "=== Ollama setup complete ==="
Info ""
Info "Models available:"
try {
    ollama list
} catch {
    Info "  (run 'ollama list' to see installed models)"
}
Info ""
Info "API endpoint: http://localhost:11434"
Info "Service name: $serviceName"
Info ""
Info "To pull additional models:"
Info "  ollama pull phi3"
Info "  ollama pull deepseek-coder:6.7b"
Info "  ollama pull nomic-embed-text  (for embeddings)"
Info ""
Info "To check service status: nssm status $serviceName"
