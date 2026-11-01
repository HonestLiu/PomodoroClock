#!/bin/bash
set -euo pipefail
app="${1:-/Applications/FocusPomodoro.app}"
extension="$app/Contents/PlugIns/FocusWidgets.appex"
if [ ! -d "$extension" ]; then echo "Missing WidgetKit extension: $extension"; exit 1; fi
codesign --verify --deep --strict "$app"
codesign -dvv "$app" 2>&1 | sed -n '/Identifier=/p; /TeamIdentifier=/p; /Signature=/p'
codesign -dvv "$extension" 2>&1 | sed -n '/Identifier=/p; /TeamIdentifier=/p; /Signature=/p'
/usr/libexec/PlistBuddy -c 'Print :DTSDKName' "$extension/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Print :FocusWidgetAppGroup' "$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Print :FocusWidgetAppGroup' "$extension/Contents/Info.plist"
pluginkit -m -A -D -vv -i com.focuspomodoro.desktop.widgets
echo 'Registration is only the first check; confirm descriptor loading in the system widget gallery.'
