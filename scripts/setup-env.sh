#!/usr/bin/env bash
# =============================================================================
# AI-PEER: Local Development Environment Setup Script (macOS / Linux / Git Bash)
# =============================================================================
# Safely initializes local .env files from .env.example templates for local
# development and testing without overwriting existing configurations.
#
# Usage:
#   ./scripts/setup-env.sh           # Copy missing .env files only (safe)
#   ./scripts/setup-env.sh --force   # Overwrite existing .env files with defaults
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

FORCE=false
for arg in "$@"; do
  case "$arg" in
    --force|-f)
      FORCE=true
      ;;
  esac
done

echo "=========================================================="
echo "  AI-PEER: Local Development Environment Setup"
echo "=========================================================="

copy_env() {
  local src="$1"
  local dest="$2"
  local label="$3"

  if [ ! -f "$src" ]; then
    echo "  [WARN] Template not found: $src (skipping)"
    return
  fi

  if [ -f "$dest" ] && [ "$FORCE" = false ]; then
    echo "  [SKIP] $dest already exists ($label). Use --force to reset."
  else
    cp "$src" "$dest"
    echo "  [OK]   Created $dest from $src ($label)"
  fi
}

copy_env "API/.env.example" "API/.env" "API Backend - Local Dev"
copy_env "front-end/AI-PEER/.env.example" "front-end/AI-PEER/.env" "Mobile Frontend - Local Dev"

echo "----------------------------------------------------------"
echo "  Done! Local development .env files are ready."
echo "  Note: Default values run in zero-credential LOCAL DEV"
echo "  mock mode. For production deployments, supply real GCP"
echo "  and Firebase credentials instead of mock defaults."
echo "=========================================================="

