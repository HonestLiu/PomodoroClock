#!/usr/bin/env bash
# 运行时一致性守卫（docs/03-architecture.md「一致性红线」）
#
# UI 层必须通过 store（数据来自 src/api 的当前运行时）取数；
# 直接 import db/queries 或 db/idb 会让 Tauri 运行时读到空的 IndexedDB。
set -uo pipefail
cd "$(dirname "$0")/.."

violations=$(grep -rn --include='*.ts' --include='*.tsx' \
  -e "from '@/db/queries'" -e "from '@/db/idb'" \
  src/components src/pages src/modals src/charts 2>/dev/null || true)

if [ -n "$violations" ]; then
  echo "❌ UI 层禁止直接引用本地存储模块（应用 src/lib/derive.ts + store）："
  echo "$violations"
  exit 1
fi
echo "✅ 运行时一致性检查通过：UI 未直接引用 db/queries 或 db/idb"
