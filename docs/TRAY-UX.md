# Tray UX fork validation

Fork GUI version: **1.0.11-mrcs64.1**. Native menu only; no new window/framework.

- Battery row shows percentage and the observed pmset charging state; source is a separate AC/battery row. Missing estimates are omitted, not rendered as `unknown remaining`. Missing pmset data is explicitly unavailable without blocking valid backend controls.
- `System charge limit: 60%` describes the current system request. Physical enforcement remains explicitly unverified in the version/help submenu; this is not proof of firmware cutoff.
- Presets 60/70/80/90/100 call the existing validated `maintain` backend with literal argv only on a click. Startup remains read-only. Selecting 100 is a new request, **not** restoring the saved original settings.
- Restore has a cancel-default native confirmation and invokes existing `maintain stop`, preserving exact original types and absent keys. Quit alone does not restore settings.
- Removed a redundant startup timer initialization that could race native read locks.

## Executed checks

- `bash tests/run.sh`: **13 Swift, 24 Python, 15 Node tests passed**. Coverage includes pmset charging/discharging/charged/not-charging, absent estimate, unknown state, pmset failure, backend errors, literal preset argv/rejected inputs, menu grouping/version, cancel-default restore, offline policy and original native security/backup regressions.
- `app/node_modules/.bin/eslint` on modules/main: passed; existing missing React-detection warning only.
- `npm run build:local` in `app`: arm64 Electron bundle built; explicit ad-hoc signing and deep strict verification passed. No personal/employer identity used; not notarized.
- `bash -n native/update-gui.sh` and `git diff --check`: passed.
- Final packaged GUI process launched successfully for 35 samples (one-second waits plus sampling overhead), generated tray menu, and stayed alive. No native request was changed. Status before/after: `64,unknown,disabled,not discharging,60` → `63,unknown,disabled,not discharging,60` (natural percentage change).
- Independent offline runtime: **0 Internet-socket samples** for launched process and descendants; NetLog **0 URL_REQUEST_START_JOB, TCP_CONNECT or DNS_TRANSACTION events**. Finite observation is not a firewall guarantee.
- Audit outputs, probe and NetLog: ignored `build/tray-ux-audit/`. The first launch exposed duplicate status reads; the final rebuilt launch had no backend-lock error.
- Visual screenshot attempted with `/usr/sbin/screencapture -x`: **unavailable**, `could not create image from display`. No screenshot exists and no visual-menu acceptance is claimed. No `computer_use` was used.

Artifact: `app/dist/mac-arm64/battery.app`.
`Contents/Resources/app.asar` SHA-256:
`3e406d03503803745bab00f416efa03ec63ce153be1f3d7d9e177e12b7169f76`.

## App-only update

Installed GUI was **not replaced**. `sudo -n true` returned `a password is required`; no credential prompt was attempted. The installed top-level bundle currently reports user ownership, not the expected root ownership; this does not establish ownership of all nested files. Privileged deployment remains a user action.

1. Quit the installed Battery using its tray menu. This does not change the active charge-limit request.
2. Run:

```sh
cd /Users/damianczerniak/Repos/battery
bash native/update-gui.sh
```

The script refuses a running installed GUI; verifies the artifact; obtains a **fresh root-controlled** staging directory with `sudo mktemp`; copies and verifies the new GUI; moves the exact previous GUI to `battery.previous.app` inside that directory; publishes, verifies, prints installed version, and opens the new GUI. It prints the precise backup path. No installer, helper/controller, sudo policy, native baseline/backup or charging preference is changed. Keep the printed rollback directory. Syntax and running-GUI refusal were tested; privileged cutover was not.

Rollback (after quitting the new GUI): use the **printed absolute** directory as `backup_dir`, preserve the current app under a fresh `sudo mktemp` directory, move `"$backup_dir/battery.previous.app"` to `/Applications/battery.app`, verify the signature and reopen. Do not rerun the controller installer for a GUI update.
