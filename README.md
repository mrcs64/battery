# Battery — macOS 27 native charge-limit fork

This fork preserves the Electron menu-bar GUI and replaces SMC polling with macOS Manual Charge Limit (MCL) preferences. It targets Apple Silicon MacBooks on macOS 27; the current machine is 27.0.1. No installed app, CLI, daemon, or charging preference was changed during development.

```sh
battery fixed60
battery maintain 60
battery maintain stop   # restore the exact prior two native preferences
battery status
```

These commands require the **reviewed local installation** described in [docs/NATIVE.md](docs/NATIVE.md). The old download installers, automatic GUI/CLI updates, SMC commands, forced discharge, and maintenance daemons are disabled. The GUI never requests an administrator password or installs components. Opening it reads status and preserves the existing request; enabling defaults to 60% when no native limit is active.

**A stored 60% request is not proof of physical 60% enforcement.** The backend verifies preference values/types and notification success. Firmware behavior, sleep/reboot persistence, and actual charging at 60% remain untested here. Apple's private behavior can change, and System Settings or other controllers can change the request.

See [implementation, source evidence, installation and rollback](docs/NATIVE.md), [self-review](docs/SELF-REVIEW.md), and [GUI development](app/README.md). Upstream project: [actuallymentor/battery](https://github.com/actuallymentor/battery). Original license remains MIT.
