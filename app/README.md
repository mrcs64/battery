# Electron GUI development

The tray GUI is preserved. It calls only `/usr/local/co.palokaj.battery/battery` using `execFile` with literal arguments and a 30-second timeout. Startup reads status; it never downloads, updates, kills a daemon, requests a password, installs components, or enables a limit.

From the repository root:

```sh
bash tests/run.sh
bash native/build.sh
cd app
npm ci --ignore-scripts --no-audit --no-fund --cache ../build/npm-cache
npm run build:local
```

`build:local` downloads the pinned Electron vendor archive when necessary (with package checksums), extracts it with stock `ditto`, builds an arm64 directory app, applies a local ad-hoc signature, and verifies the bundle. Output: `app/dist/mac-arm64/battery.app`. It does not start Electron, install the app, or publish anything. No notarization is performed without signing credentials. Existing Electron 23 dependencies are retained; a runtime upgrade is outside this backend change.

The normal `build` release script also exists, but use `build:local` for review. No production updater dependency or runtime updater remains. Only [the explicit compiled installer](../docs/NATIVE.md) installs the fork.
