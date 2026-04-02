#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Grimoire Dev Test — Build .vsix and install locally for testing
#
# Usage:
#   ./scripts/dev-test.sh          # build + install
#   ./scripts/dev-test.sh --build  # build only (no install)
#
# What it does:
#   1. Runs lint (syntax check on all source files)
#   2. Runs the test suite (109 tests)
#   3. Packages the extension as a .vsix
#   4. Installs it into your local VS Code (unless --build)
#   5. Reminds you to reload VS Code
#
# Prerequisites:
#   - Node.js 18+
#   - npm install -g @vscode/vsce   (or: npm install in vscode-extension/)
#   - VS Code's `code` CLI on PATH  (install via: Cmd+Shift+P → "Install 'code' command")
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EXT_DIR="$PROJECT_ROOT/vscode-extension"

BUILD_ONLY=false
if [[ "${1:-}" == "--build" ]]; then
  BUILD_ONLY=true
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ᚲ Grimoire Dev Test"
echo "═══════════════════════════════════════════════════════"
echo ""

# ─── Step 1: Lint ───
echo "→ Step 1/4: Syntax check..."
cd "$EXT_DIR"
npm run lint
echo "  ✓ All files parse clean"
echo ""

# ─── Step 2: Tests ───
echo "→ Step 2/4: Running tests..."
npm run test
echo ""

# ─── Step 3: Package ───
echo "→ Step 3/4: Packaging .vsix..."

# Check for vsce
if ! command -v vsce &>/dev/null; then
  echo "  ✗ vsce not found. Install it:"
  echo "    npm install -g @vscode/vsce"
  exit 1
fi

# Get version from package.json for the filename
VERSION=$(node -e "console.log(require('./package.json').version)")
VSIX_NAME="grimoire-dev-${VERSION}.vsix"

vsce package --no-dependencies --out "$VSIX_NAME" 2>&1 | tail -1
echo "  ✓ Built: $EXT_DIR/$VSIX_NAME"
echo ""

# ─── Step 4: Install ───
if [ "$BUILD_ONLY" = true ]; then
  echo "→ Step 4/4: Skipped (--build flag)"
  echo ""
  echo "  To install manually:"
  echo "    code --install-extension $EXT_DIR/$VSIX_NAME"
else
  echo "→ Step 4/4: Installing in VS Code..."

  if ! command -v code &>/dev/null; then
    echo "  ✗ 'code' CLI not found. Either:"
    echo "    1. Open VS Code → Cmd+Shift+P → 'Install code command'"
    echo "    2. Install manually: code --install-extension $EXT_DIR/$VSIX_NAME"
    exit 1
  fi

  code --install-extension "$EXT_DIR/$VSIX_NAME" --force 2>&1 | tail -1
  echo "  ✓ Installed in VS Code"
  echo ""
  echo "  ⚡ Reload VS Code to activate (Cmd+Shift+P → 'Reload Window')"
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ᚲ Done. The torch burns bright."
echo "═══════════════════════════════════════════════════════"
echo ""
