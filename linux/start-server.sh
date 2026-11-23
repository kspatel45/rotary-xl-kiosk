#!/usr/bin/env bash
# Start only the Rotary Kiosk server (then open http://localhost:8090 in a browser).
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$APP_DIR/linux/kiosk.conf" ] && . "$APP_DIR/linux/kiosk.conf"
cd "$APP_DIR" && PORT="${PORT:-8090}" exec node server.js
