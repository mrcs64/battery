# Native Manual Charge Limit backend

## Contract

On macOS 27, `battery maintain N` accepts only canonical decimal integers 1–100 (no signs, leading zeroes, whitespace, expressions, ranges or fractions). `battery fixed60` is shorthand for `maintain 60`. The root-owned compiled helper runs these fixed commands with root's HOME and a clean environment:

```
/usr/bin/defaults write com.apple.smartcharging.topoffprotection MCLFeatureState -int 1
/usr/bin/defaults write com.apple.smartcharging.topoffprotection mclLimitValue -int N
/usr/bin/notifyutil -p com.apple.smartcharging.defaultschanged
```

It exports the fixed domain with `defaults export … -`, saves the **original two keys as a typed plist**, verifies exact integer read-back, then posts the notification. Missing keys are represented by omission, independently for each key. Values such as false, zero, strings, arrays, dates and data are preserved rather than coerced to integers. `maintain stop` restores those values and types, including deleting only the keys originally absent. It explicitly deletes only originally absent keys, then uses the merging behavior of `defaults import` to restore only originally present keys, preserving unrelated preferences. Restoring a wholly absent domain can leave an empty domain file; the original key presence is restored.

The baseline is saved once per enabled session. Changing the request does not overwrite it. A separate durable pre-operation journal precedes every write; interruptions are recovered before the next set/restore. Commands, persistence, read-back, notification and rollback failures return nonzero. A failed rollback retains the journal and reports both errors; retry `battery maintain stop`. Status fails rather than presenting an unfinished transaction as successful. An exclusive root-owned lock prevents competing helper calls. A root-only `retire` operation, **absent from sudoers**, restores the baseline and prevents later set calls during uninstall.

There is no polling, force discharge, launch daemon, reassertion loop or tracker file. Changing the request in System Settings is allowed to take effect. A request of 100 writes integer 100; no firmware equivalence with disabling is assumed. The GUI uses native configured status and actual battery telemetry from `pmset`, rather than claiming SMC enforcement. When disabled, its next enable defaults to 60; an already active native limit is displayed/preserved as the selected percentage.

Avoid changing System Settings during a set/restore transaction: helper calls serialize with one another, not with Apple's private services. Restore imports contain only the two managed keys; unrelated keys are never imported or deleted. The original types are plist semantic types, not byte-for-byte original plist serialization.

## Sources inspected, 2026-10-27

Research used **read-only `gh api`**, including PR body, issue comments, review comments and complete file patches. Downloaded batterycharging source was saved as `.txt` and **never executed**. Raw evidence is in [research/](research/).

- [actuallymentor/battery PR #480](https://github.com/actuallymentor/battery/pull/480), head `fe4ff1f2e5591295e40f50c56a47aa6f72a23156`: uses the unprivileged `PowerUISmartChargeClient` JXA interface, rejects sub-80 requests, and explicitly distinguishes root `MCLFeatureState`/`mclLimitValue` writes as a separate alternative. Its polling loop and broad existing SMC permission model were not adopted.
- [PR #480 comments](https://github.com/actuallymentor/battery/pull/480#issuecomment-5793520886): one report says `isMCLSupported` is false on Sequoia 15.8 despite the framework being available. [Another comment](https://github.com/actuallymentor/battery/pull/480#issuecomment-6397801037) asks about battery health; it provides no additional sub-80 enforcement evidence. There were no inline review comments when fetched.
- [anarchy89/batterycharging README](https://github.com/anarchy89/batterycharging/blob/main/README.md), blob `a4d59d22d654ea7f346b0a7a6121965d9be847e9`, and [source](https://github.com/anarchy89/batterycharging/blob/main/batterycharging), blob `7efdf2346a6eda80dcbe31a13b8a75bbefa4e362`: identifies root preferences and notification and claims 1–100 support. Its root loop, user-executable sudo surface, PID handling, and lossy textual backup were not copied. This implementation was written separately.

These are community reports about undocumented interfaces, not Apple guarantees. In particular, preference acceptance/read-back does **not** establish an effective firmware cutoff below 80%. No physical 60% charging experiment was performed. Successful notification posting means the post command succeeded, not that firmware adopted the requested value. Inspect `pmset -g battlimit` and charging telemetry after a separately authorized installation and observe real charging around 60%, including sleep/reboot, before claiming enforcement.

## Build and nonprivileged checks

Requires Xcode Command Line Tools (Swift and Apple's `/usr/bin/python3` 3.9+), Node/npm, and an arm64 macOS build host. Run as your normal user, from this repository:

```sh
bash tests/run.sh
bash native/build.sh
cd app
npm ci --ignore-scripts --no-audit --no-fund --cache ../build/npm-cache
npm run build:local
```

The native build generates ad-hoc signed `build/battery-native` and `build/battery-installer`. The latter embeds the reviewed installer Python and SHA-256 hashes of the CLI/helper, rather than loading a root script from the checkout. Rebuild it after changing either payload or installer source. Generated products and dependency caches remain in ignored repository paths. The local Electron app is ad-hoc signed, not notarized; it has not been launched here.

## Explicit installation — prepared, NOT executed

The development session has no passwordless sudo. **Do not run these steps as part of development or request a password.** They are provided for the coordinator's later reviewed administrator action. `sudo -n` fails without existing authorization rather than prompting.

Quit `/Applications/battery.app` first through its normal Quit action. Do not reopen the old GUI during cutover. From the repository root, after inspecting the source, tests and build products:

```sh
sudo -n /usr/bin/install -d -o root -g wheel -m 700 '/Library/Application Support/battery-native-bootstrap'
sudo -n /usr/bin/install -o root -g wheel -m 755 build/battery-installer '/Library/Application Support/battery-native-bootstrap/battery-installer'
sudo -n '/Library/Application Support/battery-native-bootstrap/battery-installer' install \
  --user damianczerniak --repo "$PWD" --app "$PWD/app/dist/mac-arm64/battery.app"
```

The bootstrap validates its own root-owned location and ancestors, extracts only its embedded installer into the protected bootstrap directory, verifies its bytes, and invokes stock `/usr/bin/python3 -I` with a clean environment. It refuses direct execution from a checkout. **Never run `sudo python3 native/install.py` or grant sudo to a script in the checkout.** No installer entrypoint is granted passwordless sudo.

The installer validates macOS 27, target paths, source and staged app signatures, internal framework symlinks, native payload hashes, root ownership, and sudoers syntax. It accepts the original app owned by the selected user, preserving per-entry uid/gid/mode separately before making backups root-owned. `/Applications` may have Apple's usual root:admin 775 mode; app staging and restore staging stay in the protected backup directory. Sensitive helper/CLI/policy ancestors must remain root-owned and unwritable by group/others. Unexpected symlinks, special files, other owners, other controller commands, existing install state and unexpected staging paths fail closed. No recursive chown is performed on an existing system directory.

Before cutover it backs up the app, CLI, command symlink, helper/policy if present, legacy battery sudoers, and the validated `~/Library/LaunchAgents/battery.plist`. It bootouts only `gui/UID/com.battery.app`, removes that saved agent, and terminates only rechecked exact old CLI `maintain_synchronous` commands belonging to root/the selected user. The current machine's agent label and `/usr/local/co.palokaj.battery/battery maintain_synchronous recover` arguments were read and confirmed; the agent was not unloaded. It refuses unknown competing battery/batterycharging loops rather than killing them. User PID/tracker/log files are never trusted for root actions and remain untouched.

It installs root-owned CLI `/usr/local/co.palokaj.battery/battery`, symlink `/usr/local/bin/battery`, compiled `/usr/local/libexec/battery-native`, and GUI `/Applications/battery.app`. It replaces only `/private/etc/sudoers.d/battery` with a separate native policy for the selected user. The new policy grants only exact `set 1` through `set 100`, `restore`, `status`, and `status_csv` helper arguments. No wildcard, shell, defaults, notifyutil, install, SETENV, root script or general-purpose sudo privilege is granted. Other administrator-provided sudo policies are outside this installer.

The installer enables **no charge limit**. After successful installation, the separately authorized operator can run:

```sh
/usr/local/bin/battery fixed60
/usr/local/bin/battery status
open /Applications/battery.app
```

The GUI itself does no downloads or upstream updates. Also prevent any external Homebrew/cask/MDM upgrade of this fork; those external managers are not modified by this project.

## Restore and rollback

Stop only this fork's request, retaining the installation:

```sh
/usr/local/bin/battery maintain stop
```

Quit the fork GUI before uninstalling. Full rollback uses the same protected compiled installer:

```sh
sudo -n '/Library/Application Support/battery-native-bootstrap/battery-installer' rollback
```

It first retires the helper and restores the exact prior preference keys, then validates all backup content hashes and restores original file presence/content, symlink targets and per-entry ownership/modes. It restores the original LaunchAgent file but **does not load it** or automatically resume charging control; reopening the original GUI is a separate operator choice. Failures propagate, including rollback failures, and backups/journals remain for recovery. A partially completed rollback is retryable; a completed rollback is explicitly detected.

Protected backup state: `/Library/Application Support/battery-native-install`; helper baseline/journal: `/Library/Application Support/battery-native`; bootstrap: `/Library/Application Support/battery-native-bootstrap`. These and the installer lock are deliberately retained after rollback. Do not delete them before recovery is verified; a new install refuses existing state. Backups preserve file content, symlinks and UNIX ownership/modes, not ACLs, extended attributes, hard-link topology or timestamps. The signed app is structurally revalidated before publishing. The untouched original `smc` binary and other software are not uninstalled.

The installation/rollback command paths are tested with mocks and temporary repository fixtures. An additional non-root integration test (`build/native-tests --defaults-integration`) exercised actual `defaults` commands against disposable plist files under `build/`, confirming that import merges keys, absent keys must be explicitly deleted, and boolean/string types plus unrelated keys survive restoration. No privileged installation, real root preferences, launchctl cutover, root ownership transition, old process termination, app launch, sleep/reboot or physical charging behavior was exercised on this machine. A crash during filesystem cutover can require the explicit rollback command; it does not silently claim success.
