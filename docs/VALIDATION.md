# Independent coordinator verification

Verified on macOS 27.0.1 build 26A434, arm64, 2026-10-27. Codex CLI ran with configured defaults, no model/effort overrides; its changes were independently inspected and commands rerun.

## Executed successfully

- `bash tests/run.sh`: 13 Swift native test groups, 20 Python installer/CLI tests (`Ran 20 tests ... OK`), 5 Node GUI tests (`pass 5`, `fail 0`). These include mocked command failures, exact typed restoration and absent keys, interrupted transactions, rollback failures, narrowly generated sudoers, controller selection, symlinks, original GUI ownership, recursive backup metadata, and update disabling.
- `build/native-tests --defaults-integration`: `PASS REAL defaults preserves absence and original types without touching unrelated keys`. This writes only disposable absolute plist paths under ignored `build/`, not smartcharging preferences.
- `bash native/build.sh`: compiled and ad-hoc signed helper and embedded installer.
- `(cd app && npm ci --ignore-scripts --no-audit --no-fund)`: added 491 packages.
- `(cd app && npm run build:local)`: packaged arm64 Electron 23.3.13 app and passed deep strict signature verification. Ad-hoc only, not notarized or launched. No personal/employer signing identity used.
- `(cd app && npx eslint modules main.js)`: exit 0; React-detection warning only.
- `codesign --verify --strict build/battery-native` and corresponding installer: exit 0.
- `git diff --check`: exit 0.

An initial Electron build failed `corrupted Electron dist`; the repeatable prepare-electron step now restores the checksum-verified cached distribution before packaging. The final documented build command succeeded independently.

## Deployment blocked, installed state left in place

`sudo -n true` failed both before and after implementation: `sudo: a password is required`. No privileged installation, preference mutation, app replacement, controller termination or launchctl mutation was performed. No password was requested or supplied. The root-owned compiled installer is ready at `build/battery-installer`; reviewed bootstrap/install and rollback commands are in [NATIVE.md](NATIVE.md).

Read-only runtime checks after builds:

- `pmset -g batt`: `80%; AC attached; not charging`.
- `pmset -g battlimit`: existing two `manualChargeLimit` entries both `chargeSocLimitSoc = 80` (owners 31094 and 0).
- Existing CLI `battery status` reported maintained 60%, `0V`, `smc charging unknown`; this is not effective enforcement evidence.
- `launchctl print gui/501/com.battery.app`: running, PID 3606, original CLI with `maintain_synchronous recover`, runs=1, never exited. Same PID as initial inspection.
- Existing `/Applications/battery.app`: damianczerniak:admin, mode 755. Existing CLI: root:wheel, mode 755.
- Existing installed CLI SHA-256 after work: `ce1917ba2176851bf6096f1a343ff9e1306c748e1ee2c5fbe9e37fa3cd45bf04`.

Actual privileged cutover and root preference restoration remain unexecuted. Installer and rollback behavior were exercised with mocks/temporary repository fixtures, not production paths. Physical 60% enforcement, GUI runtime, reboot/sleep persistence and charging behavior remain unverified. Do not infer any of them from build success or preference acceptance.
