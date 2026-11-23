#!/usr/bin/env bash
# Signifi Rotary XL Kiosk - one-line installer for Linux (Lubuntu / Ubuntu / Debian / Mint, X11 desktop).
#
#   curl -fsSL https://raw.githubusercontent.com/kspatel45/rotary-xl-kiosk/main/install.sh | bash
#
# Downloads (or updates) the kiosk into ~/rotary-kiosk, runs the system setup
# (Node.js, Chromium, serial-port access, portrait rotation, start at login) and opens the kiosk full screen.
# Your sudo password is asked once. Run it again at any time to update to the latest version;
# your products and settings (data/) are kept.
set -e
# everything runs inside main(), so bash has read the whole script before it starts (safe with curl | bash)
main() {
REPO_URL="${KIOSK_REPO:-https://github.com/kspatel45/rotary-xl-kiosk.git}"
BRANCH="${KIOSK_BRANCH:-main}"
DIR="${KIOSK_DIR:-$HOME/rotary-kiosk}"

say() { printf '\n\033[1;31m▶\033[0m \033[1m%s\033[0m\n' "$*"; }

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this as the kiosk user, not as root (sudo is used where needed)." >&2; exit 1
fi
if ! command -v apt-get >/dev/null 2>&1; then
  echo "This installer supports Debian/Ubuntu-based systems (apt). Lubuntu 22.04/24.04 is recommended." >&2; exit 1
fi

say "Signifi Rotary XL Kiosk installer"
echo "Install folder: $DIR"

# ---- git + curl
if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  say "Installing git and curl"
  sudo apt-get update
  sudo apt-get install -y git curl
fi

# ---- download or update the app
if [ -d "$DIR/.git" ]; then
  say "Updating the existing installation"
  git -C "$DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$DIR" reset --hard "origin/$BRANCH"     # data/ is not tracked, so products and settings stay
else
  say "Downloading the kiosk"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$DIR"
fi

# ---- system setup (Node.js, Chromium, dialout group, brltty, autostart, kiosk.conf)
say "Setting up the system"
bash "$DIR/linux/install-lubuntu.sh"

# ---- start now in full screen
say "Starting the kiosk"
pkill -f "node $DIR/server.js" 2>/dev/null || true     # restart only this kiosk's server (picks up the update)
sleep 1
if [ -n "$DISPLAY" ]; then
  # the new dialout membership only applies after the next login, so start this first session through "sg dialout"
  if id -nG "$USER" | grep -qw dialout; then
    setsid nohup "$DIR/linux/start-kiosk.sh" >/dev/null 2>&1 &
  else
    setsid nohup sg dialout -c "$DIR/linux/start-kiosk.sh" >/dev/null 2>&1 &
  fi
  echo "The kiosk is opening full screen (exit with Alt+F4). It also starts by itself after every login."
else
  echo "No desktop session detected - the kiosk will open full screen after the next login / reboot."
fi
echo
echo "Done. Admin: tap the gear at the bottom-left, default password 55885 - change it in Admin > Connection."
}
# read prompts (sudo) from the keyboard, not from the curl pipe
if [ -r /dev/tty ]; then main "$@" </dev/tty; else main "$@"; fi
