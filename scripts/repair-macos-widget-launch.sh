#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
: "${APPLE_SIGNING_IDENTITY:?Set APPLE_SIGNING_IDENTITY to the existing Apple signing certificate name or SHA-1}"
app="/Applications/FocusPomodoro.app"
team="${APPLE_TEAM_ID:-$(codesign -dv "$app" 2>&1 | sed -n 's/^TeamIdentifier=//p')}"
stage="$(python3 "$root/scripts/stage-widget-sync-repair.py" --app "$app" --team "$team")"
# Work on a fresh copy. Do not change the installed executable or its inode.
codesign --force --options runtime --sign "$APPLE_SIGNING_IDENTITY" \
  --entitlements "$stage/Widget.entitlements" "$stage/FocusPomodoro.app/Contents/PlugIns/FocusWidgets.appex"
codesign --force --options runtime --sign "$APPLE_SIGNING_IDENTITY" \
  --entitlements "$stage/Host.entitlements" "$stage/FocusPomodoro.app"
python3 "$root/scripts/verify-widget-signing.py" "$stage/FocusPomodoro.app"
bash "$root/scripts/install-macos-widget-repair.sh" "$stage/FocusPomodoro.app"
echo 'Launch repair installed. Open FocusPomodoro from Applications to verify startup and widget sync.'
