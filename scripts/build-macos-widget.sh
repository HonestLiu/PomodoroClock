#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
output="$root/macos/build"
bundle="$output/FocusWidgets.appex"
python3 "$root/scripts/configure-widget-signing.py"
xcodebuild -quiet -project "$root/macos/FocusWidgets.xcodeproj" -scheme FocusWidgets \
  -configuration Release -derivedDataPath "$output/DerivedData" \
  -destination 'generic/platform=macOS' \
  ARCHS="arm64 x86_64" ONLY_ACTIVE_ARCH=NO CODE_SIGNING_ALLOWED=NO \
  INFOPLIST_FILE="$output/WidgetInfo.plist" build
# Xcode processes extension metadata and the extension entry point as one target.
# A raw swiftc executable with a hand-copied plist can compile yet fail at bootstrap.
ditto "$output/DerivedData/Build/Products/Release/FocusWidgets.appex" "$bundle"
if [ -n "${WIDGET_PROVISIONING_PROFILE:-}" ]; then
  cp "$WIDGET_PROVISIONING_PROFILE" "$bundle/Contents/embedded.provisionprofile"
elif [ -f "$bundle/Contents/embedded.provisionprofile" ]; then
  # A local build must not silently reuse a previous distribution profile.
  rm "$bundle/Contents/embedded.provisionprofile"
fi
codesign --force --sign "${APPLE_SIGNING_IDENTITY:--}" \
  --entitlements "$output/Widget.entitlements" "$bundle"
codesign --verify --strict "$bundle"
if [ -n "${APPLE_TEAM_ID:-}" ]; then
  signed_team="$(codesign -dv "$bundle" 2>&1 | sed -n 's/^TeamIdentifier=//p')"
  if [ "$signed_team" != "$APPLE_TEAM_ID" ]; then
    echo "Signing team mismatch: certificate=$signed_team, App Group prefix=$APPLE_TEAM_ID" >&2
    exit 1
  fi
fi
echo "WidgetKit extension: $bundle (small / medium / large, arm64 + x86_64)"
