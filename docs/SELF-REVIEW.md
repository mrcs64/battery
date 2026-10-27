# Implementation review and validation

Reviewed the working-tree implementation, complete repository scripts and Electron modules, upstream PR #480 body/comments/file patches, and batterycharging README/source. Review scope: local privilege boundary, typed preference lifecycle, interrupted writes and cutover, restore behavior, competing legacy control, and fork update isolation. No commits, pushes, installs, root preference writes, GUI launches or legacy process kills were performed.

## Findings addressed

- `defaults import` **merges** existing keys. The initial mocked behavior would have missed absent-key restoration. An actual non-root defaults probe found this; `native/Core.swift:56` now explicitly deletes only originally absent managed keys and imports only original present keys. The mock matches that behavior. An opt-in integration test verifies real absence and boolean/string restoration using repository-local plist files.
- The current original GUI is user-owned and `/Applications` normally permits admin-group writes. `native/install.py:57` accepts the selected user's original app and stores app staging under the protected backup directory, rather than trusting a writable staging path in `/Applications`. Privileged CLI/helper/policy ancestors remain strictly root-controlled.
- Recursive backup ownership conversion would lose original nested ownership and permissions. Installer metadata records every original app entry's uid/gid/mode independently, including symlink ownership, and restores it from protected staging. Content hashes detect backup damage before target mutation. ACLs/xattrs/hard-link topology/timestamps are not preserved; this is documented.
- A crash around publishing sudoers could precede the publication journal. Rollback retires a hash-verified root-owned **staged** native helper whenever helper state exists, before removing any installed files. That protected recovery helper survives intermediate installed-file renames. The retirement marker blocks new requests while uninstall restores files.
- Reading process arguments by substring would misidentify coordinator shells that merely mention maintenance commands. Controller checks use anchored executable/argument forms and recheck each PID before SIGTERM. Unknown controller commands fail closed; PID files are not trusted.
- The old GUI used a shell, swallowed child errors and could treat a timer race as success. It now uses literal `execFile` arguments, a real timeout and rejecting failures; menu errors show an unavailable state. Startup neither updates nor enables a limit. No automatic upstream update module remains.
- The old dependency lock did not match its manifest. The lock is synchronized and removes the updater dependency. The local build uses the pinned vendor Electron archive and an explicit ad-hoc signature; strict bundle verification succeeds.

## Security surface considered

The runtime authorization surface is only the compiled root helper at a fixed root-controlled path, with a named-user sudo policy enumerating exact argument combinations. Untrusted argv cannot select domains, keys, commands, paths or shells. Validation rejects noncanonical integers before any recovery/write. Root state is protected by ownership/type/mode checks, no-follow opens and a lock. Child command environments do not inherit caller HOME/PATH/DYLD settings.

The administrator installer has broader filesystem authority but no passwordless sudo grant. A compiled bootstrap must be placed in its root-owned protected location; it runs only its byte-verified embedded Python through `/usr/bin/python3 -I`. Root never imports or executes the checkout's installer script. Payload hashes pin the installed helper/CLI to that compiled installer. Root file copies use anchored directory descriptors and no-follow opens; special files and external app symlinks are rejected. The native policy does not authorize the administrator-only retirement operation.

Considered and ruled out within the reviewed scope: shell injection from native percentage/status; caller-controlled executable lookup in privileged commands; broad sudoers access; user-owned scripts behind a root runtime entrypoint; PID-file-based arbitrary process kills; runtime updater downloads; silent rollback success after command failure. Root/admin compromise and external application managers changing this fork are outside this boundary. This is a bounded source review, not a privileged runtime audit.

## Validation

- `bash tests/run.sh`: **38 tests passed** — 13 Swift backend, 20 Python installer/CLI, 5 Node GUI. Shell syntax checks also passed. No production command executes in mocked-command tests.
- `build/native-tests --defaults-integration`: the same 13 Swift tests plus **1 actual defaults integration regression passed**. Only disposable plist files under this checkout's `build/` were used; notification was mocked. No root defaults domain was used.
- `bash native/build.sh`: **passed**, arm64 Mach-O helper and compiled installer built and ad-hoc signed.
- `(cd app && npm run build:local)`: **passed**, arm64 `app/dist/mac-arm64/battery.app`; locally ad-hoc signed and `codesign --verify --deep --strict` passed. No notarization credentials were used. Electron was not launched.
- `node app/node_modules/eslint/bin/eslint.js app/modules/battery.js app/modules/interface.js app/main.js`: **passed**, no code errors/warnings. The existing React-plugin configuration emits a React-detection notice for this non-React app.
- `/usr/sbin/visudo -cf "$PWD/build/native-sudoers-test"`: **parsed OK**, using a disposable generated policy in the repository; no installed sudoers file changed.
- `python3 -m py_compile native/install.py native/embed-installer.py`, Node syntax checks and `git diff --check`: **passed**.

## Installer-failure follow-up review

The user subsequently ran the documented installer and reported `battery installer: Invalid file`.
Read-only investigation reproduced that exact exception by loading the original commit's
`save_agent` and reading the actual LaunchAgent under Apple's `/usr/bin/python3`, without
privileged writes. Its first byte is a newline before the XML declaration. `plutil -lint`
passes and launchd still runs the original job. The Swift bootstrap's different error
prefix rules it out as the emitter of this Python exception.

Reviewed changes: XML-only prefix normalization for parsing, exact original-byte backup,
unchanged no-follow/owner/type/size and exact argv validation, an additional read-only
agent preflight before BASE creation, and explicit administrator-only `archive-preflight`.
Recovery rejects a manifest or any non-backup entry, unsafe BASE, helper state, absent or
changed live target. It archives rather than deletes matching backups; it neither grants
new sudoers rights nor changes controllers/preferences/installed targets. Existing journaled
states retain their existing rollback path. Partial root-owned state remains untouched in
this session because `sudo -n true` failed. Contents could not be enumerated; the new
recovery path must validate them at runtime and fails closed if the expected state differs.

Validation: 13 Swift, 24 Python and 5 Node tests passed, including malformed/binary/unknown
agent input, symlink rejection, exact byte backup, pre-backup rejection and recovery refusal
for a manifest, changed backup or helper state. Both default Python and Apple's Python
passed the installer tests. Original `save_agent` failed on the exact live file; fixed
fd-anchored `save_agent(..., preflight=True)` passed on the same unmodified file. Rebuilt
helper/installer signatures and the existing built GUI signature passed strict validation.
No GUI/helper source changed, so a GUI rebuild was unnecessary. Corrected fail-fast
administrator commands, including safe retained-backup recovery, are in NATIVE.md.
No privileged installation/recovery, fixed60 activation or GUI launch was performed.

## Unverified boundary

Actual root defaults/notification effects, privileged ownership transitions, installation/rollback, launchctl cutover, real GUI interaction, sleep/reboot behavior, and physical 60% enforcement remain untested. Native preference read-back is only a configured request. Existing installed state remains untouched. Coordinator review is the next step; a later administrator must separately authorize installation and physical charging observation.
