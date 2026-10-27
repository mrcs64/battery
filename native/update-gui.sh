#!/bin/bash
# App-only update. Never invokes the native installer/controller or changes preferences.
set -euo pipefail
cd "$(dirname "$0")/.."
source_app="$PWD/app/dist/mac-arm64/battery.app"
target=/Applications/battery.app
if /usr/bin/pgrep -f '^/Applications/battery[.]app/Contents/MacOS/battery( |$)' >/dev/null; then
    printf '%s\n' 'Quit Battery from its tray menu, then run this script again.' >&2
    exit 1
fi
[[ -d "$source_app" && ! -L "$source_app" && -d "$target" && ! -L "$target" ]]
/usr/bin/codesign --verify --deep --strict "$source_app"
# A fresh root-controlled directory also holds the exact old app (moved, not recopied).
staging=$(sudo /usr/bin/mktemp -d /Applications/.battery-gui-update.XXXXXXXX)
printf 'Staging and rollback directory: %s\n' "$staging"
sudo /usr/bin/ditto "$source_app" "$staging/battery.new.app"
sudo /usr/sbin/chown -R root:wheel "$staging/battery.new.app"
sudo /usr/bin/codesign --verify --deep --strict "$staging/battery.new.app"
# Refuse if the user reopened the old GUI while staging.
if /usr/bin/pgrep -f '^/Applications/battery[.]app/Contents/MacOS/battery( |$)' >/dev/null; then
    printf '%s\n' 'Battery reopened; update cancelled. Staged copy retained.' >&2
    exit 1
fi
sudo /bin/mv "$target" "$staging/battery.previous.app"
if ! sudo /bin/mv "$staging/battery.new.app" "$target"; then
    sudo /bin/mv "$staging/battery.previous.app" "$target"
    exit 1
fi
/usr/bin/codesign --verify --deep --strict "$target"
/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$target/Contents/Info.plist"
printf 'Previous GUI retained exactly at: %s/battery.previous.app\n' "$staging"
/usr/bin/open "$target"
