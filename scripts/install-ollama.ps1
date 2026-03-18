# install-ollama.ps1
# Installs Ollama, registers it as a Windows Service, pulls free models.
# Run via SSH: powershell -ExecutionPolicy Bypass -File D:\remote-pc-access\scripts\install-ollama.ps1

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

# 1. Install Ollama
Info "Checking Ollama..."
if (Test-Command "ollama") {
    Success "Ollama already installed: $(ollama --version)"
} else {
    Info "Installing Ollama via winget..."
    winget install --id Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements
    Refresh-Path

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
        Err "Install manually from https://ollama.com/download then re-run."
        exit 1
    }
}

# 2. Configure Ollama to listen on all interfaces so pc-agent service can reach it
Info "Configuring Ollama host..."
[System.Environment]::SetEnvironmentVariable("OLLAMA_HOST", "0.0.0.0:11434", "Machine")
[System.Environment]::SetEnvironmentVariable("OLLAMA_NUM_CTX", "8192", "Machine")
$env:OLLAMA_HOST  = "0.0.0.0:11434"
$env:OLLAMA_NUM_CTX = "8192"
Success "OLLAMA_HOST set to 0.0.0.0:11434"

# 3. Find ollama.exe path
$ollamaExe = $null
$cmd = Get-Command ollama -ErrorAction SilentlyContinue
if ($cmd) {
    $ollamaExe = $cmd.Source
}
if (-not $ollamaExe) {
    foreach ($c in @("$env:LOCALAPPDATA\Programs\Ollama\ollama.exe", "$env:ProgramFiles\Ollama\ollama.exe")) {
        if (Test-Path $c) { $ollamaExe = $c; break }
    }
}
if (-not $ollamaExe) {
    Err "Cannot locate ollama.exe"
    exit 1
}
Info "Found ollama at: $ollamaExe"

# 4. Register OllamaService via NSSM (auto-starts on boot)
$serviceName = "OllamaService"
Info "Registering $serviceName as Windows Service..."

$prev = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existing) {
    Warn "Service already exists - removing to reinstall..."
    nssm stop   $serviceName 2>$null | Out-Null
    nssm remove $serviceName confirm 2>$null | Out-Null
}
$ErrorActionPreference = $prev

nssm install $serviceName $ollamaExe "serve"
nssm set $serviceName AppDirectory    (Split-Path $ollamaExe)
nssm set $serviceName DisplayName     "Ollama LLM Server"
nssm set $serviceName Description     "Local LLM server used by Remote PC Access"
nssm set $serviceName Start           SERVICE_AUTO_START
nssm set $serviceName AppStdout       "$env:LOCALAPPDATA\ollama\service.log"
nssm set $serviceName AppStderr       "$env:LOCALAPPDATA\ollama\service-error.log"
nssm set $serviceName AppEnvironmentExtra "OLLAMA_HOST=0.0.0.0:11434" "OLLAMA_NUM_CTX=8192"

Info "Starting OllamaService..."
nssm start $serviceName
Start-Sleep -Seconds 4

$svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Success "OllamaService is running"
} else {
    Warn "Service may not be running yet - check: nssm status $serviceName"
}

# 5. Wait for Ollama API to be ready
Info "Waiting for Ollama API..."
$ready = $false
for ($i = 0; $i -lt 15; $i++) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -UseBasicParsing -TimeoutSec 3
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    Info "Not ready yet, waiting... ($($i+1)/15)"
    Start-Sleep -Seconds 2
}
if (-not $ready) {
    Warn "Ollama API did not respond in time - models will not be pulled now."
    Warn "Run 'ollama pull llama3.2:3b' manually once it is running."
    exit 0
}
Success "Ollama API is ready"

# 6. Pull free models
# All models below are free and open-source - no account or payment needed.
# llama3.2:3b  ~2GB  - fast general purpose chat (Meta, Apache 2.0)
# mistral:7b   ~4GB  - strong reasoning and writing (Mistral AI, Apache 2.0)
# codellama:7b ~4GB  - code completion and review (Meta, custom open license)
$models = @(
    "llama3.2:3b",
    "mistral:7b",
    "codellama:7b"
)

foreach ($model in $models) {
    Info "Pulling $model (this may take a while on first run)..."
    $body = "{`"name`": `"$model`", `"stream`": false}"
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:11434/api/pull" `
            -Method POST -Body $body -ContentType "application/json" `
            -UseBasicParsing -TimeoutSec 600
        if ($r.StatusCode -eq 200) {
            Success "$model ready"
        } else {
            Warn "$model pull returned status $($r.StatusCode)"
        }
    } catch {
        Warn "Pull failed for $model - run manually: ollama pull $model"
    }
}

# 7. Windows Firewall rule
Info "Adding firewall rule for Ollama (port 11434)..."
$ruleName = "Ollama LLM Server"
$fwRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if (-not $fwRule) {
    New-NetFirewallRule -DisplayName $ruleName `
        -Direction Inbound -Protocol TCP -LocalPort 11434 `
        -Action Allow -Profile Private | Out-Null
    Success "Firewall rule added"
} else {
    Success "Firewall rule already exists"
}

# Done
Info ""
Info "=== Ollama setup complete ==="
Info "Service: OllamaService (starts automatically on boot)"
Info "API: http://localhost:11434"
Info ""
Info "Installed models:"
ollama list
