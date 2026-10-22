<#
.SYNOPSIS
  Compile the AI-PEER Android client inside a Docker container on Windows.

.DESCRIPTION
  Builds the Android builder Docker container and compiles the React Native APK,
  saving the output to build-output/app-release.apk without requiring local JDK or Android SDK.

.PARAMETER BuildType
  Specifies 'release' (default, standalone APK with embedded JS) or 'debug' (requires live Metro).

.PARAMETER Install
  Automatically sideloads the compiled APK to a connected Android phone via ADB and launches the app.

.PARAMETER Launch
  Alias for -Install; sideloads and opens the app immediately on the phone.

.EXAMPLE
  .\scripts\build-android-docker.ps1
  .\scripts\build-android-docker.ps1 -Install
  .\scripts\build-android-docker.ps1 -BuildType debug -Install
#>

param (
    [ValidateSet("release", "debug")]
    [string]$BuildType = "release",
    [switch]$Install,
    [switch]$Launch
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
    $GradleTask = ":app:assembleRelease"
    $ApkPath = "app/build/outputs/apk/release/app-release.apk"
    $OutApk = Join-Path $OutputDir "app-release.apk"
} else {
    $GradleTask = ":app:assembleDebug"
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
Write-Host "==========================================================" -ForegroundColor Cyan

if ($Install -or $Launch) {
    Write-Host ""
    Write-Host "==> Checking for connected Android phone via ADB..." -ForegroundColor Cyan
    if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
        Write-Warning "'adb' command not found on PATH. Please install Android Platform Tools to enable auto-installation."
        Write-Host "  Manual install: adb install -r `"$OutApk`"" -ForegroundColor Yellow
    } else {
        $devices = adb devices | Select-String -Pattern "\bdevice\b"
        if (-not $devices) {
            Write-Warning "No authorized Android device detected by 'adb devices'. Please ensure your phone is connected with USB debugging enabled."
            Write-Host "  Once connected, run: adb install -r `"$OutApk`"" -ForegroundColor Yellow
        } else {
            Write-Host "==> Configuring reverse port proxy (8085 -> host)..." -ForegroundColor Green
            adb reverse tcp:8085 tcp:8085
            if ($BuildType -eq "debug") {
                adb reverse tcp:8081 tcp:8081
            }

            Write-Host "==> Sideloading APK ($OutApk)..." -ForegroundColor Green
            adb install -r "$OutApk"

            Write-Host "==> Launching AI-PEER on phone..." -ForegroundColor Green
            adb shell am start -n com.anonymous.aipeer/.MainActivity

            Write-Host ""
            Write-Host "  SUCCESS: AI-PEER is installed and running on your device!" -ForegroundColor Green
        }
    }
} else {
    Write-Host ""
    Write-Host "  To install on a connected Android phone:" -ForegroundColor Yellow
    Write-Host "    adb install -r `"$OutApk`"" -ForegroundColor Yellow
    Write-Host "  Or re-run with auto-install:" -ForegroundColor DarkGray
    Write-Host "    .\scripts\build-android-docker.ps1 -Install" -ForegroundColor DarkGray
}
