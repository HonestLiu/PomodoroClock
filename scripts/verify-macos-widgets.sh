#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
output="$root/macos/build/verify"
mkdir -p "$output/module-cache"
xcrun swiftc -parse-as-library -module-cache-path "$output/module-cache" \
  "$root/macos/Widgets/WidgetData.swift" "$root/macos/Widgets/VerifyWidgetData.swift" -o "$output/verify"
"$output/verify"
cd "$root/src-tauri"
cargo test --offline --test widgets
