#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
# Compatibility entry point; the npm CLI now owns signing setup and verification.
npm run tauri build -- --bundles app "$@"
