# =============================================================================
# AI-PEER: Local Development Environment Setup Script (Windows PowerShell)
# =============================================================================
# Safely initializes local .env files from .env.example templates for local
# development and testing without overwriting existing configurations.
#
# Usage:
#   .\scripts\setup-env.ps1          # Copy missing .env files only (safe)
#   .\scripts\setup-env.ps1 -Force   # Overwrite existing .env files with defaults
# =============================================================================

param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
Set-Location $RepoRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  AI-PEER: Local Development Environment Setup" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

function Copy-EnvFile {
    param(
        [string]$Src,
        [string]$Dest,
        [string]$Label
    )

    if (-not (Test-Path $Src)) {
        Write-Host "  [WARN] Template not found: $Src (skipping)" -ForegroundColor Yellow
        return
    }

    if ((Test-Path $Dest) -and (-not $Force)) {
        Write-Host "  [SKIP] $Dest already exists ($Label). Use -Force to reset." -ForegroundColor Gray
    } else {
        Copy-Item -Path $Src -Destination $Dest -Force
        Write-Host "  [OK]   Created $Dest from $Src ($Label)" -ForegroundColor Green
    }
}

Copy-EnvFile -Src "API/.env.example" -Dest "API/.env" -Label "API Backend - Local Dev"
Copy-EnvFile -Src "front-end/AI-PEER/.env.example" -Dest "front-end/AI-PEER/.env" -Label "Mobile Frontend - Local Dev"

Write-Host "----------------------------------------------------------" -ForegroundColor Cyan
Write-Host "  Done! Local development .env files are ready."
Write-Host "  Note: Default values run in zero-credential LOCAL DEV"
Write-Host "  mock mode. For production deployments, supply real GCP"
Write-Host "  and Firebase credentials instead of mock defaults."
Write-Host "==========================================================" -ForegroundColor Cyan

