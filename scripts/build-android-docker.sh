#!/usr/bin/env bash
# =============================================================================
# AI-PEER: Containerized Android Build Script (macOS / Linux / Git Bash)
# =============================================================================
# Compiles the React Native Android APK inside a self-contained Docker container
# and exports the binary to ./build-output/app-release.apk.
#
# Usage:
#   ./scripts/build-android-docker.sh                      # Release APK (standalone)
#   ./scripts/build-android-docker.sh --install            # Build & install to USB phone
#   ./scripts/build-android-docker.sh debug --install      # Debug APK & install
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

BUILD_TYPE="release"
AUTO_INSTALL=false

for arg in "$@"; do
  case "$arg" in
    release|debug)
      BUILD_TYPE="$arg"
      ;;
    --install|-i|--launch|-l)
      AUTO_INSTALL=true
      ;;
  esac
done

mkdir -p "$REPO_ROOT/build-output"

echo "=========================================================="
echo "  AI-PEER: Containerized Android Build ($BUILD_TYPE)"
echo "=========================================================="

# Verify Docker is installed
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is not installed or not on PATH." >&2
  echo "Please install Docker Desktop: https://www.docker.com/products/docker-desktop/" >&2
  exit 1
fi

# Verify Docker daemon is running
if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker daemon is not running. Please start Docker Desktop and try again." >&2
  exit 1
fi

echo "==> Building Android builder Docker image..."
docker compose build android-builder

if [ "$BUILD_TYPE" = "release" ]; then
  GRADLE_TASK=":app:assembleRelease"
  APK_PATH="app/build/outputs/apk/release/app-release.apk"
  OUT_APK="build-output/app-release.apk"
else
  GRADLE_TASK=":app:assembleDebug"
  APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
  OUT_APK="build-output/app-debug.apk"
fi

echo "==> Running compilation task '$GRADLE_TASK' inside container..."
CONTAINER_CMD="set -e && if [ ! -f android/app/debug.keystore ]; then keytool -genkey -v -keystore android/app/debug.keystore -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Android Debug,O=Android,C=US'; fi && if [ ! -d node_modules/react-native ]; then echo '==> Installing npm dependencies (first-time volume setup)...' && npm ci --prefer-offline --no-audit; else echo '==> Using cached node_modules volume (skipping npm ci)...'; fi && cd android && sed -i 's/\r$//' gradlew && chmod +x gradlew && ./gradlew $GRADLE_TASK -PreactNativeArchitectures=arm64-v8a --build-cache --max-workers=4 && mkdir -p /output && cp $APK_PATH /output/$(basename "$OUT_APK") && echo '===> Successfully copied APK to host output directory.'"

docker compose run --rm -e CMAKE_BUILD_PARALLEL_LEVEL=4 android-builder bash -c "$CONTAINER_CMD"

echo "=========================================================="
echo "  BUILD SUCCESSFUL!"
echo "  APK location: $REPO_ROOT/$OUT_APK"
echo "=========================================================="

if [ "$AUTO_INSTALL" = true ]; then
  echo ""
  echo "==> Checking for connected Android phone via ADB..."
  if ! command -v adb >/dev/null 2>&1; then
    echo "WARNING: 'adb' command not found on PATH. Please install Android Platform Tools."
    echo "  Manual install: adb install -r \"$OUT_APK\""
  else
    if ! adb devices | grep -w "device" >/dev/null 2>&1; then
      echo "WARNING: No authorized Android device detected by 'adb devices'."
      echo "  Once connected, run: adb install -r \"$OUT_APK\""
    else
      echo "==> Configuring reverse port proxy (8085 -> host)..."
      adb reverse tcp:8085 tcp:8085
      if [ "$BUILD_TYPE" = "debug" ]; then
        adb reverse tcp:8081 tcp:8081
      fi

      echo "==> Sideloading APK ($OUT_APK)..."
      if ! adb install -r "$OUT_APK"; then
        echo "==> Existing installation signature mismatch; uninstalling old version and reinstalling..."
        adb uninstall com.anonymous.aipeer || true
        adb install "$OUT_APK"
      fi

      echo "==> Launching AI-PEER on phone..."
      adb shell am start -n com.anonymous.aipeer/.MainActivity

      echo ""
      echo "  SUCCESS: AI-PEER is installed and running on your device!"
    fi
  fi
else
  echo ""
  echo "  To install on a connected Android phone:"
  echo "    adb install -r \"$OUT_APK\""
  echo "  Or re-run with auto-install:"
  echo "    ./scripts/build-android-docker.sh --install"
fi
