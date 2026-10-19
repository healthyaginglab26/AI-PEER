<#
.SYNOPSIS
  Compile the AI-PEER Android client inside a Docker container on Windows.

.DESCRIPTION
  Builds the Android builder Docker container and compiles the React Native APK,
  saving the output to build-output/app-debug.apk without requiring local JDK or Android SDK.

.PARAMETER BuildType
  Specifies 'debug' (default) or 'release'.

.EXAMPLE
  .\scripts\build-android-docker.ps1
  .\scripts\build-android-docker.ps1 -BuildType release
#>

param (
    [ValidateSet("debug", "release")]
    [string]$BuildType = "debug"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

$OutputDir = Join-Path $RepoRoot "build-output"
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  AI-PEER: Containerized Android Build ($BuildType)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Check if Docker is installed
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker is not installed or not available on PATH. Please install Docker Desktop: https://www.docker.com/products/docker-desktop/"
    exit 1
}

# Check if Docker daemon is running
try {
    docker info 2>&1 | Out-Null
} catch {
    Write-Error "Docker daemon is not running. Please start Docker Desktop and try again."
    exit 1
}

Write-Host "==> Building Android builder Docker image..." -ForegroundColor Green
docker compose build android-builder

if ($BuildType -eq "release") {
    $GradleTask = "assembleRelease"
    $ApkPath = "app/build/outputs/apk/release/app-release.apk"
    $OutApk = Join-Path $OutputDir "app-release.apk"
} else {
    $GradleTask = "assembleDebug"
    $ApkPath = "app/build/outputs/apk/debug/app-debug.apk"
    $OutApk = Join-Path $OutputDir "app-debug.apk"
}

Write-Host "==> Running compilation task '$GradleTask' inside container..." -ForegroundColor Green
$ContainerCmd = "set -e && if [ ! -f android/app/debug.keystore ]; then keytool -genkey -v -keystore android/app/debug.keystore -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Android Debug,O=Android,C=US'; fi && npm ci && cd android && sed -i 's/\r$//' gradlew && chmod +x gradlew && ./gradlew $GradleTask -PreactNativeArchitectures=arm64-v8a --max-workers=2 && mkdir -p /output && cp $ApkPath /output/$(Split-Path -Leaf $OutApk) && echo '===> Successfully copied APK to host output directory.'"

docker compose run --rm -e CMAKE_BUILD_PARALLEL_LEVEL=2 android-builder bash -c "$ContainerCmd"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker compilation failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  BUILD SUCCESSFUL!" -ForegroundColor Green
Write-Host "  APK location: $OutApk" -ForegroundColor White
Write-Host ""
Write-Host "  To install on a connected Android phone:" -ForegroundColor Yellow
Write-Host "    adb install -r `"$OutApk`"" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan
