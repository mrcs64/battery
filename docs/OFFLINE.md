# Local-only GUI network policy

The native-fork tray GUI needs no network access. Updates remain manual. Help
menu links still open the user's system browser, only when clicked.

## Investigation and certainty

A CLI launch of the **previous installed** `/Applications/battery.app` reproduced
connections to `8.8.8.8:443` and `8.8.4.4:443` within 15 seconds. Its Chromium NetLog
recorded automatic secure-DNS configuration (`secure_dns_mode: 1`,
`allow_dns_over_https_upgrade: true`) and requests to
`https://dns.google/dns-query` carrying a DNS query for `www.gstatic.com`.
The configured plain DNS nameservers were Google's `8.8.8.8` and `8.8.4.4`.
This establishes Chromium DNS-over-HTTPS traffic in this reproduction, consistent
with the reported LuLu destination. The historical PID was already gone; it does
not establish the exact origin of every connection in that earlier launch.
Source inspection found no startup HTTP request or remaining updater import;
the three external help links are explicit `shell.openExternal` menu callbacks.
Do not describe this as proven app telemetry or an updater request.

## Defense in depth

`app/modules/offline.js` runs before `app.whenReady()` and before interface imports:

- Disable Chromium background networking and component updates.
- Disable automatic proxy discovery with `no-proxy-server`.
- Disable the `DnsOverHttpsUpgrade` feature, preserving other disabled features.
- Refuse hostname resolution with `host-resolver-rules=MAP * ~NOTFOUND`.
- Register a session-created listener to cancel all requests except local
  `file:` and `data:` resources (including future partitions and direct-IP URLs).

After ready, but before tray initialization, call Electron's supported
`configureHostResolver` API with secure DNS off, no secure DNS servers, and the
built-in resolver disabled, then explicitly protect the default session.
Electron 23 requires this API after ready; the earlier switches cover startup.
Chromium internal requests may bypass `webRequest`, hence both layers are needed.
This is application hardening, not an OS firewall: Node sockets, newly introduced
native networking, and future Chromium changes require separate review.

## Verification

- `bash tests/run.sh`: 13 Swift, 24 Python, 9 Node tests pass.
- ESLint on the changed application modules: pass (existing React-detection warning).
- `npm run build:local --prefix app`: arm64 bundle built and ad-hoc signature verified.
- Launching the hardened packaged app for 35 seconds: 61 `lsof -nP` samples,
  no battery-family Internet sockets. Chromium NetLog contained no URL requests,
  DNS transactions, or TCP connection events. Secure DNS ended in mode 0 with
  no DoH servers. A transient native status-lock error recovered on refresh.
- Live Electron API probe: default and new in-memory sessions both reject
  direct-IP HTTPS and loopback HTTP with `ERR_BLOCKED_BY_CLIENT` (four checks).
- Native startup remained read-only. Status before/after retained limit 60;
  backend reported disabled on both reads. No enable/disable/install/rollback
  or charging preference mutation was performed.

Raw local logs/probe are in ignored `build/network-audit/`; NetLogs may contain
machine network details and are intentionally not committed. Finite sampling is
not a packet capture or a guarantee about every future action/suspend cycle.
Browser help-click behavior was preserved in source/regression checks, not
exercised by opening the user's browser.

## App-only deployment

Artifact: `app/dist/mac-arm64/battery.app`. The installed bundle is root-owned;
noninteractive sudo was unavailable, so **it was not replaced**. Do not rerun the
native installer: existing controller, backups, sudo policy, and preferences
must remain untouched. With the tray app quit, a user may perform this app-only
replacement (the staging/backup names must not already exist):

```sh
cd /Users/damianczerniak/Repos/battery
sudo test ! -e /Applications/battery.offline-staged.app
sudo test ! -e /Applications/battery.before-offline.app
sudo ditto app/dist/mac-arm64/battery.app /Applications/battery.offline-staged.app
sudo codesign --verify --deep --strict /Applications/battery.offline-staged.app
sudo mv /Applications/battery.app /Applications/battery.before-offline.app
sudo mv /Applications/battery.offline-staged.app /Applications/battery.app
codesign --verify --deep --strict /Applications/battery.app
open /Applications/battery.app
```

Run commands one at a time and stop on any failure. Keep the old bundle as a
rollback copy, not running concurrently. This changes only the GUI application.
Installed-path runtime verification and a fresh LuLu observation remain pending.
