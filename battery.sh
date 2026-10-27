#!/bin/bash
# Native fork: no downloads, no daemon, no shell-evaluated configuration.
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
helper=/usr/local/libexec/battery-native
case "${1:-help}" in
    maintain)
        [ "$#" -eq 2 ] || { echo "Usage: battery maintain INTEGER|stop" >&2; exit 2; }
        if [ "$2" = stop ]; then exec /usr/bin/sudo -n "$helper" restore; fi
        [[ "$2" =~ ^([1-9]|[1-9][0-9]|100)$ ]] || { echo "Expected integer 1-100" >&2; exit 2; }
        exec /usr/bin/sudo -n "$helper" set "$2"
        ;;
    fixed60)
        [ "$#" -eq 1 ] || exit 2
        exec /usr/bin/sudo -n "$helper" set 60
        ;;
    status|status_csv)
        [ "$#" -eq 1 ] || exit 2
        exec /usr/bin/sudo -n "$helper" "$1"
        ;;
    update|reinstall|uninstall|visudo|create_daemon|remove_daemon|maintain_synchronous|charge|discharge|adapter|charging)
        echo "Disabled in native fork. Use maintain INTEGER, maintain stop, or the reviewed installer/rollback." >&2
        exit 2
        ;;
    help|--help|-h)
        echo 'Battery native macOS 27 fork
battery fixed60             request a native 60% limit
battery maintain INTEGER    request a native 1-100% limit
battery maintain stop       restore exact prior native settings
battery status              configured request (not physical verification)
battery status_csv          Electron-compatible battery status
No automatic updates, forced discharge or maintenance daemon.'
        ;;
    *) echo "Unknown command" >&2; exit 2 ;;
esac
