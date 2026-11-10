#!/usr/bin/env bash
#
# android-doctor.sh — preflight check for the AI-PEER Android build environment.
#
# Run this before attempting an Android build, especially after pulling new
# changes or onto a fresh machine. Read-only: it never installs, removes,
# or modifies anything. Exits 0 if every required check passes, 1 otherwise.
#
# Works on macOS, Linux, and Windows Git Bash.
#
# Invoke via:  npm run android:doctor
#

set -u

# Resolve repo root (this script lives in scripts/) so we can be invoked from
# anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Color helpers — only emit ANSI codes when stdout is a TTY.
if [ -t 1 ]; then
  GREEN=$'\033[32m'
  RED=$'\033[31m'
  YELLOW=$'\033[33m'
  BOLD=$'\033[1m'
  RESET=$'\033[0m'
else
  GREEN=""; RED=""; YELLOW=""; BOLD=""; RESET=""
fi

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

pass() {
  printf "  %sPASS%s  %s\n" "$GREEN" "$RESET" "$1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  printf "  %sFAIL%s  %s\n" "$RED" "$RESET" "$1"
  if [ -n "${2:-}" ]; then
    printf "         %s\n" "$2"
  fi
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

warn() {
  printf "  %sWARN%s  %s\n" "$YELLOW" "$RESET" "$1"
  if [ -n "${2:-}" ]; then
    printf "         %s\n" "$2"
  fi
  WARN_COUNT=$((WARN_COUNT + 1))
}

printf "%sAI-PEER Android environment doctor%s\n\n" "$BOLD" "$RESET"

# 1. Java / JDK available and is 17 or 21. Gradle uses JAVA_HOME when set
# (Android Studio's bundled JBR lives under Android Studio and is NOT on
# PATH on Windows — so requiring `java` on PATH would false-negative on
# every Android Studio default install). Accept java-on-PATH OR
# JAVA_HOME/bin/java(.exe).
JAVA_BIN=""
if command -v java >/dev/null 2>&1; then
  JAVA_BIN="java"
elif [ -n "${JAVA_HOME:-}" ]; then
  # Try both the POSIX and Windows locations.
  for candidate in "$JAVA_HOME/bin/java" "$JAVA_HOME/bin/java.exe"; do
    if [ -x "$candidate" ] || [ -f "$candidate" ]; then
      JAVA_BIN="$candidate"
      break
    fi
  done
fi

if [ -n "$JAVA_BIN" ]; then
  # `java -version` writes to stderr. Capture and parse.
  JAVA_VERSION_RAW=$("$JAVA_BIN" -version 2>&1 | head -1)
  # Extract the version string inside quotes, e.g. "17.0.9" or "1.8.0_321".
  JAVA_VERSION=$(printf "%s" "$JAVA_VERSION_RAW" | sed -E 's/.*"([^"]+)".*/\1/')
  # Major version: before JDK 9 it's 1.X; from JDK 9 onward it's X.Y.Z.
  JAVA_MAJOR=$(printf "%s" "$JAVA_VERSION" | awk -F. '{ if ($1 == "1") print $2; else print $1 }')
  if [ "$JAVA_MAJOR" = "17" ] || [ "$JAVA_MAJOR" = "21" ]; then
    pass "Java $JAVA_VERSION (major $JAVA_MAJOR, supported) — $JAVA_BIN"
  else
    fail "Java $JAVA_VERSION (need JDK 17 or 21 for RN 0.81)" \
      "Install Temurin 17 or 21 from https://adoptium.net, or point JAVA_HOME at an existing JDK 17/21. Android Studio → Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK can also be set."
  fi
else
  fail "No usable Java found (not on PATH, JAVA_HOME unset or empty)" \
    "Install Temurin 17 or 21 from https://adoptium.net, OR set JAVA_HOME to an existing JDK 17/21 install (e.g. Android Studio's bundled JBR at C:\\Program Files\\Android\\Android Studio\\jbr on Windows)."
fi

# 2. JAVA_HOME set and points somewhere real
if [ -n "${JAVA_HOME:-}" ]; then
  if [ -d "$JAVA_HOME" ]; then
    pass "JAVA_HOME=$JAVA_HOME"
  else
    fail "JAVA_HOME set to $JAVA_HOME but directory does not exist" \
      "Point JAVA_HOME at a real JDK 17/21 install, or unset it and rely on PATH."
  fi
else
  warn "JAVA_HOME not set" \
    "Gradle may still work via PATH, but Android Studio and some tools expect JAVA_HOME."
fi

# 3. ANDROID_HOME or ANDROID_SDK_ROOT set and points at a real SDK
ANDROID_SDK=""
if [ -n "${ANDROID_HOME:-}" ] && [ -d "${ANDROID_HOME:-}" ]; then
  ANDROID_SDK="$ANDROID_HOME"
  pass "ANDROID_HOME=$ANDROID_HOME"
elif [ -n "${ANDROID_SDK_ROOT:-}" ] && [ -d "${ANDROID_SDK_ROOT:-}" ]; then
  ANDROID_SDK="$ANDROID_SDK_ROOT"
  pass "ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT"
else
  fail "Neither ANDROID_HOME nor ANDROID_SDK_ROOT points at an existing directory" \
    "Set ANDROID_HOME to your Android SDK location (typically ~/Library/Android/sdk on macOS, %LOCALAPPDATA%\\Android\\Sdk on Windows, ~/Android/Sdk on Linux)."
fi

# 4. adb available — either on PATH or inside $ANDROID_HOME/platform-tools.
# Expo / RN's Android run scripts find adb via ANDROID_HOME even when it's
# not on PATH, so requiring it on PATH would false-negative a standard
# Android Studio install on Windows.
ADB_BIN=""
if command -v adb >/dev/null 2>&1; then
  ADB_BIN="adb"
elif [ -n "$ANDROID_SDK" ]; then
  for candidate in "$ANDROID_SDK/platform-tools/adb" "$ANDROID_SDK/platform-tools/adb.exe"; do
    if [ -x "$candidate" ] || [ -f "$candidate" ]; then
      ADB_BIN="$candidate"
      break
    fi
  done
fi

if [ -n "$ADB_BIN" ]; then
  ADB_VERSION=$("$ADB_BIN" --version 2>/dev/null | head -1)
  pass "adb available ($ADB_VERSION) — $ADB_BIN"
else
  fail "adb not found (not on PATH, not under ANDROID_HOME/platform-tools)" \
    "Install Android SDK Platform-Tools via Android Studio → SDK Manager → SDK Tools, or add \$ANDROID_HOME/platform-tools to your PATH."
fi

# 5. platform-tools present under SDK root
if [ -n "$ANDROID_SDK" ]; then
  if [ -d "$ANDROID_SDK/platform-tools" ]; then
    pass "platform-tools installed at $ANDROID_SDK/platform-tools"
  else
    fail "platform-tools missing at $ANDROID_SDK/platform-tools" \
      "Install via Android Studio → SDK Manager → SDK Tools → Android SDK Platform-Tools."
  fi

  # 6. NDK present — warn only, Expo may fetch on demand
  if [ -d "$ANDROID_SDK/ndk" ] && [ -n "$(ls -A "$ANDROID_SDK/ndk" 2>/dev/null)" ]; then
    NDK_VERSIONS=$(ls "$ANDROID_SDK/ndk" | tr '\n' ' ')
    pass "NDK installed (versions: $NDK_VERSIONS)"
  else
    warn "No NDK found at $ANDROID_SDK/ndk" \
      "Expo/Gradle will attempt to download one on first build. If that fails, install manually via Android Studio → SDK Manager → SDK Tools → NDK (Side by side)."
  fi
fi

# 7. Node version matches .nvmrc
if [ -f .nvmrc ]; then
  PINNED_NODE=$(tr -d '[:space:]' < .nvmrc)
  if command -v node >/dev/null 2>&1; then
    NODE_VERSION=$(node --version | sed 's/^v//')
    NODE_MAJOR=$(printf "%s" "$NODE_VERSION" | cut -d. -f1)
    PINNED_MAJOR=$(printf "%s" "$PINNED_NODE" | cut -d. -f1)
    if [ "$NODE_MAJOR" = "$PINNED_MAJOR" ]; then
      pass "Node v$NODE_VERSION (matches .nvmrc: $PINNED_NODE)"
    else
      fail "Node v$NODE_VERSION (expected major $PINNED_NODE)" \
        "Run: nvm use   (or: nvm install $PINNED_NODE)"
    fi
  else
    fail "node not found" "Install Node $PINNED_NODE via nvm/fnm/asdf/volta."
  fi
else
  warn ".nvmrc missing" "Cannot verify Node version."
fi

# 8. .env present
if [ -f .env ]; then
  pass ".env present"
else
  warn ".env missing" "Run: cp .env.example .env  (then fill in credentials)"
fi

# 9. node_modules/ present and contains the critical native deps
if [ -d node_modules ]; then
  MISSING_DEPS=""
  for dep in react-native react-native-vision-camera react-native-screens react-native-worklets-core; do
    if [ ! -d "node_modules/$dep" ]; then
      MISSING_DEPS="$MISSING_DEPS $dep"
    fi
  done
  if [ -z "$MISSING_DEPS" ]; then
    pass "node_modules/ contains react-native, vision-camera, screens, worklets-core"
  else
    fail "node_modules/ missing:${MISSING_DEPS}" "Run: npm install"
  fi
else
  fail "node_modules/ missing" "Run: npm install"
fi

# 10. Android Gradle wrapper script present
if [ -f android/gradlew ]; then
  pass "android/gradlew present"
else
  fail "android/gradlew missing" \
    "This is a bare workflow project — the wrapper should be committed. Check git status."
fi

# 11. Total system RAM — warn if < 8 GB
TOTAL_RAM_GB=""
case "$(uname -s 2>/dev/null || echo unknown)" in
  Darwin)
    if command -v sysctl >/dev/null 2>&1; then
      TOTAL_RAM_BYTES=$(sysctl -n hw.memsize 2>/dev/null || echo "")
      if [ -n "$TOTAL_RAM_BYTES" ]; then
        TOTAL_RAM_GB=$((TOTAL_RAM_BYTES / 1024 / 1024 / 1024))
      fi
    fi
    ;;
  Linux)
    if [ -r /proc/meminfo ]; then
      TOTAL_RAM_KB=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo "")
      if [ -n "$TOTAL_RAM_KB" ]; then
        TOTAL_RAM_GB=$((TOTAL_RAM_KB / 1024 / 1024))
      fi
    fi
    ;;
  MINGW*|MSYS*|CYGWIN*)
    # Windows Git Bash: use wmic if available.
    if command -v wmic >/dev/null 2>&1; then
      TOTAL_RAM_BYTES=$(wmic computersystem get totalphysicalmemory 2>/dev/null | tr -d ' \r' | grep -E '^[0-9]+$' | head -1)
      if [ -n "$TOTAL_RAM_BYTES" ]; then
        TOTAL_RAM_GB=$((TOTAL_RAM_BYTES / 1024 / 1024 / 1024))
      fi
    fi
    ;;
esac

if [ -n "$TOTAL_RAM_GB" ]; then
  if [ "$TOTAL_RAM_GB" -ge 8 ] 2>/dev/null; then
    pass "System RAM: ${TOTAL_RAM_GB} GB"
  else
    warn "System RAM: ${TOTAL_RAM_GB} GB (recommended: 8 GB+)" \
      "Close Chrome / Android Studio / other heavy apps before building. Consider lowering org.gradle.jvmargs -Xmx in android/gradle.properties if builds OOM."
  fi
else
  warn "Could not determine system RAM" "Platform-specific detection failed; skipping memory check."
fi

# Summary
printf "\n%sSummary:%s %s%d passed%s, %s%d failed%s, %s%d warnings%s\n" \
  "$BOLD" "$RESET" \
  "$GREEN" "$PASS_COUNT" "$RESET" \
  "$RED" "$FAIL_COUNT" "$RESET" \
  "$YELLOW" "$WARN_COUNT" "$RESET"

if [ "$FAIL_COUNT" -gt 0 ]; then
  printf "\nFix the failures above before attempting an Android build.\n"
  exit 1
fi

printf "\nEnvironment looks good. You can build Android.\n"
exit 0
