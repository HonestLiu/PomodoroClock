#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
output="$root/macos/build/previews"
mkdir -p "$output/module-cache"
xcrun swiftc -parse-as-library -D WIDGET_PREVIEW -module-cache-path "$output/module-cache" \
  "$root/macos/Widgets/WidgetData.swift" "$root/macos/Widgets/FocusWidget.swift" \
  "$root/macos/Widgets/RenderPreviews.swift" -o "$output/render"
"$output/render" "$output"
