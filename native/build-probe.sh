#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
/usr/bin/clang -Wall -Wextra -Werror -O2 native/charging-override.c -o build/charging-override
/usr/bin/codesign --force --sign - build/charging-override
