#!/usr/bin/env bash
# 一键验收：类型 → 一致性红线 → 种子数据口径 → 计时模式口径 → 日历/倒数纪念日/AI 口径 → Rust 查询测试 → 构建 → 可选截图验收。
#
# 为什么要它：这些检查以前分散在 README/docs 各处手工执行，漏跑一项就会把回归带进提交
# （本项目发生过：首启种子写空库导致 16 项数据口径失败，而 build/tsc 全绿）。
#
# 用法：
#   ./tools/check-all.sh              # 全部静态/构建检查
#   ./tools/check-all.sh --with-shots # 追加 Playwright 截图验收（会自动起 preview）
#   ./tools/check-all.sh --skip-build # 跳过 vite build（只查类型与测试）
#
# 注意：macOS 自带没有 timeout 命令，脚本里不要依赖它。

set -uo pipefail
cd "$(dirname "$0")/.."

WITH_SHOTS=0
SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --with-shots) WITH_SHOTS=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "未知参数：$arg（可用 --with-shots / --skip-build）"; exit 2 ;;
  esac
done

PASS=0
FAIL=0
FAILED_STEPS=()

step() {
  local name="$1"; shift
  printf '\n\033[1m▶ %s\033[0m\n' "$name"
  local start=$SECONDS
  if "$@"; then
    printf '\033[32m✓ %s（%ss）\033[0m\n' "$name" "$((SECONDS - start))"
    PASS=$((PASS + 1))
  else
    printf '\033[31m✗ %s 失败（%ss）\033[0m\n' "$name" "$((SECONDS - start))"
    FAIL=$((FAIL + 1))
    FAILED_STEPS+=("$name")
  fi
}

step_typecheck() { npx tsc --noEmit; }
step_parity() { bash tools/check-runtime-parity.sh; }
step_seed() { npx tsx tools/verify-data.ts > /tmp/check-all-seed.log 2>&1 && tail -1 /tmp/check-all-seed.log; }
step_timer() { npx tsx tools/verify-timer.ts > /tmp/check-all-timer.log 2>&1 && tail -1 /tmp/check-all-timer.log; }
step_calendar() { npx tsx tools/verify-calendar.ts > /tmp/check-all-calendar.log 2>&1 && tail -1 /tmp/check-all-calendar.log; }
step_countdown() { npx tsx tools/verify-countdown.ts > /tmp/check-all-countdown.log 2>&1 && tail -1 /tmp/check-all-countdown.log; }
step_ai() { npx tsx tools/verify-ai.ts > /tmp/check-all-ai.log 2>&1 && tail -1 /tmp/check-all-ai.log; }
step_rust() { (cd src-tauri && cargo test --test queries 2>&1 | tail -3); }
step_build() { npm run build > /tmp/check-all-build.log 2>&1 && grep -E 'dist/|built in' /tmp/check-all-build.log | tail -8; }
step_shots() {
  # 复用已在跑的 preview；没有就自己起一个（退出时关掉）
  local started=0
  if ! curl -fsS -o /dev/null http://localhost:4173/ 2>/dev/null; then
    echo "  （4173 无服务，启动 vite preview）"
    npx vite preview --port 4173 > /tmp/check-all-preview.log 2>&1 &
    local pid=$!
    started=1
    for _ in $(seq 1 40); do
      curl -fsS -o /dev/null http://localhost:4173/ 2>/dev/null && break
      sleep 0.25
    done
    if ! curl -fsS -o /dev/null http://localhost:4173/ 2>/dev/null; then
      echo "  preview 启动失败："; cat /tmp/check-all-preview.log
      [ "$started" = 1 ] && kill "$pid" 2>/dev/null
      return 1
    fi
    local rc=0
    node tools/shoot.mjs || rc=$?
    kill "$pid" 2>/dev/null
    return $rc
  fi
  node tools/shoot.mjs
}

step "类型检查 tsc --noEmit" step_typecheck
step "运行时一致性红线（UI 禁直连 db）" step_parity
step "种子数据口径（PRD §7.2 / verify-data.ts）" step_seed
step "计时模式口径（番茄钟/倒计时/正计时 / verify-timer.ts）" step_timer
step "日历 7 视图模型层（lib/calendar / verify-calendar.ts）" step_calendar
step "倒数纪念日口径（自然日差/每年重复/每月/自定义/提醒 / verify-countdown.ts）" step_countdown
step "AI 能力口径（时间注入/结构化解析/校验/降级/估时校准 / verify-ai.ts）" step_ai
step "Rust 查询测试（cargo test --test queries）" step_rust
if [ "$SKIP_BUILD" = 0 ]; then
  step "生产构建（tsc + vite build）" step_build
else
  echo -e "\n（--skip-build：跳过 vite build）"
fi
if [ "$WITH_SHOTS" = 1 ]; then
  step "截图验收（S1–S5 + 深色 + 英文）" step_shots
fi

printf '\n──────── 汇总 ────────\n'
printf '通过 %d 项，失败 %d 项\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '失败项：\n'
  printf '  - %s\n' "${FAILED_STEPS[@]}"
  exit 1
fi
printf '\033[32m全部通过\033[0m\n'
