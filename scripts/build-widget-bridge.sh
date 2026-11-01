#!/bin/bash
set -euo pipefail
# Called by cargo build.rs. Output stays under Cargo's target directory.
output="$1"
target="$2"
root="$(cd "$(dirname "$0")/.." && pwd)"
sdk="$(xcrun --sdk macosx --show-sdk-path)"
mkdir -p "$output/module-cache"
arch="${target%%-*}"
if [ "$arch" = aarch64 ]; then arch=arm64; fi
xcrun swiftc -parse-as-library -emit-library -static -O \
  -module-name FocusWidgetBridge -module-cache-path "$output/module-cache" \
  -target "$arch-apple-macosx11.0" -sdk "$sdk" \
  "$root/macos/Widgets/WidgetData.swift" "$root/macos/Bridge/WidgetBridge.swift" \
  -o "$output/libfocus_widget_bridge.a"
