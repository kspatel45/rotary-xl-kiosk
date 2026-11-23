#!/usr/bin/env bash
# Signifi Rotary XL Kiosk on Lubuntu: rotate the screen to portrait, start the server, open Chromium full screen.
# Started automatically at login (see install-lubuntu.sh). Exit the kiosk browser with Alt+F4.
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROTATE=right; OUTPUT=; PORT=8090; HIDE_CURSOR_SECONDS=3
[ -f "$APP_DIR/linux/kiosk.conf" ] && . "$APP_DIR/linux/kiosk.conf"
URL="http://localhost:${PORT}"
LOG="$HOME/.cache/rotary-kiosk"
mkdir -p "$LOG"

# ---- screen: portrait rotation (display + touch input), no blanking
if command -v xrandr >/dev/null 2>&1 && [ -n "$ROTATE" ]; then
  [ -z "$OUTPUT" ] && OUTPUT="$(xrandr --query | awk '/ connected/{print $1; exit}')"
  [ -n "$OUTPUT" ] && xrandr --output "$OUTPUT" --rotate "$ROTATE"
  # rotate every touch screen the same way, otherwise taps land in the wrong place
  case "$ROTATE" in
    left)     M="0 -1 1 1 0 0 0 0 1" ;;
    right)    M="0 1 0 -1 0 1 0 0 1" ;;
    inverted) M="-1 0 1 0 -1 1 0 0 1" ;;
    *)        M="1 0 0 0 1 0 0 0 1" ;;
  esac
  if command -v xinput >/dev/null 2>&1; then
    xinput list --name-only 2>/dev/null | grep -i -E 'touch|ilitek|egalax|goodix|wacom|elan|eeti' | while read -r dev; do
      xinput set-prop "$dev" "Coordinate Transformation Matrix" $M 2>/dev/null
    done
  fi
fi
if command -v xset >/dev/null 2>&1; then xset s off; xset s noblank; xset -dpms; fi
if command -v unclutter >/dev/null 2>&1 && [ "${HIDE_CURSOR_SECONDS:-0}" -gt 0 ]; then
  pkill -x unclutter 2>/dev/null; unclutter -idle "$HIDE_CURSOR_SECONDS" -root &
fi

# ---- server (skip if already running)
if ! curl -s -o /dev/null "$URL/api/state"; then
  (cd "$APP_DIR" && PORT="$PORT" nohup node "$APP_DIR/server.js" >"$LOG/server.log" 2>&1 &)
  for i in $(seq 1 30); do curl -s -o /dev/null "$URL/api/state" && break; sleep 0.5; done
fi

# ---- browser
BROWSER=""
for b in chromium chromium-browser google-chrome google-chrome-stable; do
  command -v "$b" >/dev/null 2>&1 && { BROWSER="$b"; break; }
done
if [ -z "$BROWSER" ]; then
  echo "Chromium not found - run linux/install-lubuntu.sh" >&2
  xdg-open "$URL" &
  exit 1
fi

# a dedicated profile inside $HOME (the Chromium snap can only write there); clear the "restore pages?" bubble
PROFILE="$HOME/.config/rotary-kiosk-profile"
mkdir -p "$PROFILE/Default"
sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' "$PROFILE/Default/Preferences" 2>/dev/null

exec "$BROWSER" --kiosk --app="$URL" --user-data-dir="$PROFILE" \
  --no-first-run --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
  --disable-translate --disable-features=TranslateUI --disable-pinch --overscroll-history-navigation=0 \
  --check-for-update-interval=31536000 --password-store=basic --touch-events=enabled \
  >"$LOG/browser.log" 2>&1
