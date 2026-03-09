#!/bin/bash
# ==============================================
# Auto-update Capacitor config with current Codespace URL
# Run this after creating a new Codespace or when URLs change
# Usage: ./scripts/update-codespace-url.sh
# ==============================================

set -e

if [ -z "$CODESPACE_NAME" ]; then
  echo "Error: Not running in a GitHub Codespace (CODESPACE_NAME not set)"
  exit 1
fi

PORT="${PORT:-3000}"
NEW_URL="https://${CODESPACE_NAME}-${PORT}.app.github.dev"
CONFIG_FILE="capacitor.config.json"

if [ ! -f "$CONFIG_FILE" ]; then
  CONFIG_FILE="$(dirname "$0")/../capacitor.config.json"
fi

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: capacitor.config.json not found"
  exit 1
fi

# Extract current URL
CURRENT_URL=$(grep -oP '"url":\s*"\K[^"]+' "$CONFIG_FILE" || echo "")

if [ "$CURRENT_URL" = "$NEW_URL" ]; then
  echo "Capacitor URL already up to date: $NEW_URL"
  exit 0
fi

# Replace URL in capacitor.config.json using sed
sed -i "s|\"url\":.*\"https://.*app.github.dev\"|\"url\": \"${NEW_URL}\"|" "$CONFIG_FILE"

echo "Updated capacitor.config.json:"
echo "  Old: $CURRENT_URL"
echo "  New: $NEW_URL"
echo ""
echo "Run 'npx cap sync android' to sync changes to the Android project."
