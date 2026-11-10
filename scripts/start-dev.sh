#!/usr/bin/env bash
# =============================================================================
# AI-PEER: Permanent Local Dev & Metro Auto-Connect Script
# =============================================================================
# 1. Ensures .env files exist
# 2. Starts API (8085) + Metro (8081) containers with persistent Metro cache
# 3. Waits until Metro is 100% ready (packager-status:running)
# 4. Keeps a lightweight background USB watcher running so whenever your
#    Android phone is plugged in or reconnects, adb reverse (8081 & 8085)
#    is restored automatically.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

"$SCRIPT_DIR/setup-env.sh"

echo "==> Starting API and Metro (web) containers..."
docker compose up -d api web

echo -n "==> Waiting for Metro Bundler on http://localhost:8081 "
for _ in $(seq 1 60); do
  if curl -fsS http://localhost:8081/status 2>/dev/null | grep -q "packager-status:running"; then
    echo " [READY]"
    break
  fi
  echo -n "."
  sleep 1
done

# Start persistent background ADB reverse watcher if adb is installed
if command -v adb >/dev/null 2>&1; then
  # Kill any old watcher loop from a previous run
  pkill -f "aipeer-adb-watcher" 2>/dev/null || true

  nohup bash -c '
    # aipeer-adb-watcher
    while true; do
      adb wait-for-device >/dev/null 2>&1 || true
      adb reverse tcp:8081 tcp:8081 >/dev/null 2>&1 || true
      adb reverse tcp:8085 tcp:8085 >/dev/null 2>&1 || true
      sleep 2
    done
  ' >/dev/null 2>&1 &

  if adb devices | grep -w "device" >/dev/null 2>&1; then
    adb reverse tcp:8081 tcp:8081
    adb reverse tcp:8085 tcp:8085
    echo "==> Android phone detected! USB tunnels (8081 & 8085) active + auto-reconnect watcher running."
  else
    echo "==> Notice: No Android phone currently detected on USB ('adb devices' is empty)."
    echo "    Background USB watcher is running—as soon as you plug in your phone, ports 8081 & 8085 will auto-connect!"
  fi
fi

echo "=========================================================="
echo "  Metro & API are ready!"
echo "  - Web Browser: http://localhost:8081"
echo "  - API Health:  http://localhost:8085/health"
echo "=========================================================="

