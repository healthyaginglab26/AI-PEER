#!/usr/bin/env bash
#
# android-clean.sh — full nuke-and-rebuild of the Android native build state.
# Run this when an Android build fails with mysterious Kotlin / CMake / dex
# errors, "works on my machine" weirdness, or after pulling gradle.properties
# / build.gradle changes and the incremental build starts behaving strangely.
#
# What it does:
#   1. Wipe android/.gradle          (per-project Gradle cache)
#   2. Wipe android/build            (top-level build outputs)
#   3. Wipe android/app/build        (app module build outputs)
#   4. Wipe android/app/.cxx         (C++ / CMake intermediate state)
#   5. Run ./gradlew clean           (triggers Gradle's own cleanup hooks)
#
# Does NOT touch:
#   - ~/.gradle (shared across all projects on this machine — nuking it
#     would re-download several GB of dependencies for unrelated projects)
#   - node_modules (use `npm install` for that)
#   - Any iOS file
#
# After this finishes, run:  npx expo run:android   (or: npm run android)
# Expect the next build to take several minutes longer than usual.
#
# Invoke via:  npm run android:clean
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [ -t 1 ]; then
  BOLD=$'\033[1m'
  YELLOW=$'\033[33m'
  RESET=$'\033[0m'
else
  BOLD=""; YELLOW=""; RESET=""
fi

step() {
  printf "\n%s==>%s %s\n" "$BOLD" "$RESET" "$1"
}

if [ ! -d android ]; then
  printf "Error: android/ directory not found. Run from the AI-PEER repo root.\n" >&2
  exit 1
fi

printf "%s%sThis will wipe android/.gradle, android/build, android/app/build, and android/app/.cxx.%s\n" \
  "$BOLD" "$YELLOW" "$RESET"
printf "%sThe next build will take several minutes longer than usual.%s\n\n" \
  "$YELLOW" "$RESET"

step "Removing android/.gradle"
rm -rf android/.gradle

step "Removing android/build"
rm -rf android/build

step "Removing android/app/build"
rm -rf android/app/build

step "Removing android/app/.cxx"
rm -rf android/app/.cxx

step "Running ./gradlew clean"
if [ -f android/gradlew ]; then
  # On Windows Git Bash, gradlew.bat is the canonical entry, but gradlew
  # (the POSIX shell script) also works under bash. Use it uniformly.
  (cd android && ./gradlew clean --console=plain --warning-mode=none) || \
    printf "  (gradlew clean failed — the directory removals above are the main thing, safe to ignore)\n"
else
  printf "  android/gradlew missing; skipping gradle clean step.\n"
fi

printf "\n%sDone.%s Next build: %snpx expo run:android%s (or %snpm run android%s).\n" \
  "$BOLD" "$RESET" \
  "$BOLD" "$RESET" \
  "$BOLD" "$RESET"
