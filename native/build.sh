#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
/usr/bin/swiftc -module-cache-path "$PWD/build/module-cache" -O native/Core.swift native/main.swift -o build/battery-native
/usr/bin/codesign --force --sign - build/battery-native
python3 native/embed-installer.py
/usr/bin/swiftc -module-cache-path "$PWD/build/module-cache" -O build/installer-payload.swift build/main.swift -o build/battery-installer
/usr/bin/codesign --force --sign - build/battery-installer
