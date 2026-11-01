#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
source_app="${1:-$root/src-tauri/target/debug/bundle/macos/FocusPomodoro.app}"
installed="/Applications/FocusPomodoro.app"
codesign --verify --deep --strict "$source_app"
python3 "$root/scripts/verify-widget-signing.py" "$source_app"
host_team="$(codesign -dv "$source_app" 2>&1 | sed -n 's/^TeamIdentifier=//p')"
widget_team="$(codesign -dv "$source_app/Contents/PlugIns/FocusWidgets.appex" 2>&1 | sed -n 's/^TeamIdentifier=//p')"
if [ -z "$host_team" ] || [ "$host_team" = 'not set' ] || [ "$host_team" != "$widget_team" ]; then
  echo 'Refusing installation: host and widget must have the same real signing team.' >&2
  exit 1
fi
if pgrep -x focus-pomodoro > /dev/null; then
  echo 'Quit FocusPomodoro normally before replacing its app bundle.' >&2
  exit 1
fi
backup="$(mktemp -d /private/tmp/FocusPomodoro-widget-backup.XXXXXX)"
incoming="$(mktemp -d /Applications/.FocusPomodoro-incoming.XXXXXX)"
# Never overwrite an executable in place: macOS caches its signature by vnode.
# Copy to fresh inodes, validate, then replace the entire bundle by rename.
ditto "$source_app" "$incoming/FocusPomodoro.app"
python3 "$root/scripts/verify-widget-signing.py" "$incoming/FocusPomodoro.app"
installed_new=0
restore_on_error() {
  local result=$?
  trap - ERR
  if [ "$installed_new" = 1 ] && [ -d "$installed" ]; then
    mv "$installed" "$incoming/RejectedFocusPomodoro.app"
  fi
  if [ ! -e "$installed" ] && [ -d "$backup/FocusPomodoro.app" ]; then
    mv "$backup/FocusPomodoro.app" "$installed"
  fi
  echo "Installation failed; previous app restored when available. Staging retained: $incoming" >&2
  exit "$result"
}
trap restore_on_error ERR
if [ -d "$installed" ]; then mv "$installed" "$backup/FocusPomodoro.app"; fi
mv "$incoming/FocusPomodoro.app" "$installed"
installed_new=1
codesign --verify --deep --strict "$installed"
trap - ERR
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$installed"
pluginkit -a "$installed/Contents/PlugIns/FocusWidgets.appex"
rmdir "$incoming"
echo "Updated application; previous app backup: $backup/FocusPomodoro.app"
echo 'Existing tasks, records, settings, and desktop widget layouts were not changed.'
