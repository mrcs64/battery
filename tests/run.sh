#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
/usr/bin/swiftc -module-cache-path "$PWD/build/module-cache" native/Core.swift tests/main.swift -o build/native-tests
build/native-tests
python3 -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/*.test.js
bash -n battery.sh setup.sh update.sh native/build.sh
