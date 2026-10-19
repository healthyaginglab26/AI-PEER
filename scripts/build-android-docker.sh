#!/usr/bin/env bash
#
# build-android-docker.sh — Compile the AI-PEER Android client inside a Docker container.
#
# Works on macOS, Linux, and Windows Git Bash.
# Outputs: build-output/app-debug.apk
#
# Usage:
#   ./scripts/build-android-docker.sh
#   ./scripts/build-android-docker.sh release   # (to build release APK)
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

BUILD_TYPE="${1:-debug}"
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
  GRADLE_TASK="assembleRelease"
  APK_PATH="app/build/outputs/apk/release/app-release.apk"
  OUT_APK="$OUTPUT_DIR/app-release.apk"
else
  GRADLE_TASK="assembleDebug"
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
echo ""
echo "  To install on a connected Android phone:"
echo "    adb install -r $OUT_APK"
echo "=========================================================="
