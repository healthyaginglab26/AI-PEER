#!/usr/bin/env bash
#
# build-android-docker.sh — Compile the AI-PEER Android client inside a Docker container.
#
# Works on macOS, Linux, and Windows Git Bash.
# Outputs: build-output/app-release.apk
#
# Usage:
#   ./scripts/build-android-docker.sh          # (default: release APK with embedded JS)
#   ./scripts/build-android-docker.sh debug    # (to build debug APK requiring Metro)
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

BUILD_TYPE="release"
DO_INSTALL=false

for arg in "$@"; do
  case "$arg" in
    release|debug)
      BUILD_TYPE="$arg"
      ;;
    --install|-i|--launch|-l|install)
      DO_INSTALL=true
      ;;
  esac
done

OUTPUT_DIR="$REPO_ROOT/build-output"
mkdir -p "$OUTPUT_DIR"

echo "=========================================================="
echo "  AI-PEER: Containerized Android Build ($BUILD_TYPE)"
echo "=========================================================="

# Check if Docker is installed
if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker is not installed or not available on PATH." >&2
  echo "Install Docker Desktop: https://www.docker.com/products/docker-desktop/" >&2
  exit 1
fi

# Check if Docker daemon is running
if ! docker info >/dev/null 2>&1; then
  echo "Error: Docker daemon is not running." >&2
  echo "Please start Docker Desktop and try again." >&2
  exit 1
fi

echo "==> Building Android builder Docker image..."
docker compose build android-builder

if [ "$BUILD_TYPE" = "release" ]; then
  GRADLE_TASK=":app:assembleRelease"
  APK_PATH="app/build/outputs/apk/release/app-release.apk"
  OUT_APK="$OUTPUT_DIR/app-release.apk"
else
  GRADLE_TASK=":app:assembleDebug"
  APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
  OUT_APK="$OUTPUT_DIR/app-debug.apk"
fi

echo "==> Running compilation task '$GRADLE_TASK' inside container..."
docker compose run --rm -e CMAKE_BUILD_PARALLEL_LEVEL=2 android-builder bash -c "
  set -e
  if [ ! -f android/app/debug.keystore ]; then
    keytool -genkey -v -keystore android/app/debug.keystore -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Android Debug,O=Android,C=US'
  fi
  npm ci
  cd android
  sed -i 's/\r$//' gradlew
  chmod +x gradlew
  ./gradlew $GRADLE_TASK -PreactNativeArchitectures=arm64-v8a --max-workers=2
  mkdir -p /output
  cp $APK_PATH /output/\$(basename \"\$OUT_APK\")
  echo '===> Successfully copied APK to host output directory.'
"

echo "=========================================================="
echo "  BUILD SUCCESSFUL!"
echo "  APK location: $OUT_APK"
echo "=========================================================="

if [ "$DO_INSTALL" = true ]; then
  echo ""
  echo "==> Checking for connected Android phone via ADB..."
  if ! command -v adb >/dev/null 2>&1; then
    echo "Warning: 'adb' command not found on PATH. Please install Android Platform Tools." >&2
    echo "  Manual install: adb install -r $OUT_APK"
  else
    if ! adb devices | grep -qE "\bdevice\b"; then
      echo "Warning: No authorized Android device detected. Please connect your phone with USB debugging enabled." >&2
      echo "  Once connected, run: adb install -r $OUT_APK"
    else
      echo "==> Configuring reverse port proxy (8085 -> host)..."
      adb reverse tcp:8085 tcp:8085 || true
      if [ "$BUILD_TYPE" = "debug" ]; then
        adb reverse tcp:8081 tcp:8081 || true
      fi

      echo "==> Sideloading APK ($OUT_APK)..."
      adb install -r "$OUT_APK"

      echo "==> Launching AI-PEER on phone..."
      adb shell am start -n com.anonymous.aipeer/.MainActivity || true

      echo ""
      echo "  SUCCESS: AI-PEER is installed and running on your device!"
    fi
  fi
else
  echo ""
  echo "  To install on a connected Android phone:"
  echo "    adb install -r $OUT_APK"
  echo "  Or re-run with auto-install:"
  echo "    ./scripts/build-android-docker.sh --install"
fi
