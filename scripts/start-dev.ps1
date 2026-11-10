<#
.SYNOPSIS
  Start the AI-PEER Local Dev Environment (API + Metro) and configure ADB USB tunnels.

.DESCRIPTION
  1. Ensures .env files exist (via setup-env.ps1)
  2. Starts the API (8085) and Metro (8081) containers with persistent Metro cache
  3. Waits until Metro Bundler reports 'packager-status:running' on http://localhost:8081/status
  4. Configures 'adb reverse' for ports 8081 and 8085 if an Android phone is connected

.EXAMPLE
  .\scripts\start-dev.ps1
#>

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

& (Join-Path $ScriptDir "setup-env.ps1")

Write-Host "==> Starting API and Metro (web) containers..." -ForegroundColor Cyan
docker compose up -d api web

Write-Host -NoNewline "==> Waiting for Metro Bundler on http://localhost:8081 " -ForegroundColor Cyan
$metroReady = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:8081/status" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($resp.Content -match "packager-status:running") {
            Write-Host " [READY]" -ForegroundColor Green
            $metroReady = $true
            break
        }
    } catch {
        # Ignore while Metro is still booting
    }
    Write-Host -NoNewline "."
    Start-Sleep -Seconds 1
}
if (-not $metroReady) {
    Write-Host ""
    Write-Warning "Metro Bundler did not report ready within 60s. Check 'docker compose logs -f web'."
}

if (Get-Command adb -ErrorAction SilentlyContinue) {
    $devices = adb devices | Select-String -Pattern "\bdevice\b"
    if ($devices) {
        adb reverse tcp:8081 tcp:8081
        adb reverse tcp:8085 tcp:8085
        Write-Host "==> Android phone detected! USB tunnels (8081 & 8085) are active." -ForegroundColor Green
    } else {
        Write-Host "==> Notice: No Android phone currently detected on USB ('adb devices' is empty)." -ForegroundColor Yellow
        Write-Host "    After plugging in your phone, re-run .\scripts\start-dev.ps1 to forward ports 8081 & 8085." -ForegroundColor Yellow
    }
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Metro & API are ready!" -ForegroundColor Green
Write-Host "  - Web Browser: http://localhost:8081" -ForegroundColor White
Write-Host "  - API Health:  http://localhost:8085/health" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Cyan

