#!/bin/bash
# ────────────────────────────────────────────────────────────────────────────────
# نظام المحاسبة - Electron Desktop Build Script (WINDOWS ONLY)
# ────────────────────────────────────────────────────────────────────────────────
# This script builds the Next.js static export for Electron.
# Since API routes are incompatible with `output: 'export'`, and Electron handles
# all API requests via the protocol handler (app://) + api-routes.js, we temporarily
# move the API routes out of the way during the build.
#
# Output: Windows NSIS installer (x64)
#
# Usage:
#   bash scripts/electron-build.sh          # Build static export only
#   bash scripts/electron-build.sh --pack   # Build + create Windows NSIS installer
# ────────────────────────────────────────────────────────────────────────────────

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$PROJECT_DIR/src/app/api"
API_BACKUP="$PROJECT_DIR/.api-routes-backup"

echo "═══════════════════════════════════════════════════════════════"
echo "  نظام المحاسبة - Electron Desktop Build (Windows Only)"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Step 1: Generate Prisma Client
echo "[1/5] Generating Prisma Client..."
cd "$PROJECT_DIR"
npx prisma generate

# Step 2: Backup API routes (they are incompatible with output: export)
echo "[2/5] Backing up API routes (incompatible with static export)..."
if [ -d "$API_DIR" ]; then
  if [ -d "$API_BACKUP" ]; then
    rm -rf "$API_BACKUP"
  fi
  mv "$API_DIR" "$API_BACKUP"
  echo "   API routes backed up to .api-routes-backup/"
else
  echo "   No API routes directory found, skipping backup"
fi

# Step 3: Build static export (API directory is removed, no API routes needed)
# In the Electron desktop app, ALL API requests are intercepted by the
# app:// protocol handler in electron/main.js and routed to electron/api-routes.js.
# The Next.js API routes are NOT needed in the static export.
echo "[3/5] Building static export (output: export)..."
echo "   Note: API routes excluded - handled by Electron protocol handler instead"

# Build with Electron mode (API directory already removed in step 2)
DATABASE_URL="file:./db/custom.db" BUILD_MODE=electron npx next build

# Step 4: Restore API routes
echo "[4/5] Restoring API routes..."
rm -rf "$API_DIR"
if [ -d "$API_BACKUP" ]; then
  mv "$API_BACKUP" "$API_DIR"
  echo "   API routes restored"
fi

# Step 5: Verify the output
echo "[5/5] Build complete!"
echo ""

if [ -d "$PROJECT_DIR/out" ]; then
  HTML_SIZE=$(du -sh "$PROJECT_DIR/out" | cut -f1)
  echo "   Output directory: out/"
  echo "   Size: $HTML_SIZE"
  echo ""
  echo "Static export ready for Windows!"
  echo ""
  echo "To run as Electron desktop app:"
  echo "  npx electron ."
  echo ""
  echo "To create Windows NSIS installer:"
  echo "  npx electron-builder --win"
  echo ""

  # If --pack flag, create the Windows installer
  if [ "$1" = "--pack" ]; then
    echo "Creating Windows NSIS installer..."
    npx electron-builder --win --x64
    echo ""

    # Show the output file
    if [ -d "$PROJECT_DIR/dist-electron" ]; then
      INSTALLER=$(find "$PROJECT_DIR/dist-electron" -name "*.exe" -type f | head -1)
      if [ -n "$INSTALLER" ]; then
        INSTALLER_SIZE=$(du -sh "$INSTALLER" | cut -f1)
        echo "   Windows installer created: $INSTALLER"
        echo "   Size: $INSTALLER_SIZE"
      fi
    fi
  fi
else
  echo "   Error: out/ directory not found. Build may have failed."
  exit 1
fi
