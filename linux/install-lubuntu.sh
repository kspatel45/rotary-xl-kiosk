#!/usr/bin/env bash
# Signifi Rotary XL Kiosk - one-time setup on Lubuntu (22.04 / 24.04, LXQt).
# Run from the app folder:   bash linux/install-lubuntu.sh
# What it does (asks for your sudo password once):
#   1. installs Node.js and Chromium if they are missing
#   2. adds you to the "dialout" group so the app may open /dev/ttyACM* and /dev/ttyUSB*
#   3. removes "brltty" (a braille-display service that grabs CH340/CH341 USB-serial adapters on Ubuntu)
#   4. registers the kiosk to start automatically when you log in (LXQt autostart)
#   5. turns off screen blanking / screensaver for this user
set -e
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "Rotary Kiosk folder: $APP_DIR"

# ---- 1. Node.js (18+) and Chromium
need_node=1
if command -v node >/dev/null 2>&1; then
  major=$(node -p 'process.versions.node.split(".")[0]')
  [ "$major" -ge 18 ] && need_node=0
fi
if [ $need_node -eq 1 ]; then
  echo "Installing Node.js..."
  sudo apt-get update
  sudo apt-get install -y nodejs
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  if [ "$major" -lt 18 ]; then
    echo "The Ubuntu Node.js package is older than 18. Installing Node.js 20 from NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi
fi
echo "Node.js $(node --version)"

if ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1 && ! command -v google-chrome >/dev/null 2>&1; then
  echo "Installing Chromium..."
  sudo snap install chromium || sudo apt-get install -y chromium-browser
fi

# x11-xserver-utils gives xset / xrandr; xinput rotates the touch screen with the display
sudo apt-get install -y x11-xserver-utils xinput unclutter >/dev/null 2>&1 || true

# ---- 2. serial port access
if ! id -nG "$USER" | grep -qw dialout; then
  sudo usermod -aG dialout "$USER"
  echo "Added $USER to the dialout group (takes effect after you log out and in, or reboot)."
fi

# ---- 3. brltty steals CH340 adapters (common on Arduino Mega clones)
if dpkg -l brltty 2>/dev/null | grep -q '^ii'; then
  echo "Removing brltty (it blocks CH340 USB-serial adapters)..."
  sudo apt-get remove -y brltty
fi

# ---- 4. autostart on login
chmod +x "$APP_DIR/linux/start-kiosk.sh" "$APP_DIR/linux/start-server.sh"
mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/rotary-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Signifi Rotary XL Kiosk
Comment=Starts the Rotary XL kiosk server and opens it full screen
Exec=$APP_DIR/linux/start-kiosk.sh
X-GNOME-Autostart-enabled=true
X-LXQt-Need-Tray=false
EOF
echo "Autostart entry: $HOME/.config/autostart/rotary-kiosk.desktop"

# ---- 5. screen settings file (rotation for the portrait screen)
if [ ! -f "$APP_DIR/linux/kiosk.conf" ]; then
  cp "$APP_DIR/linux/kiosk.conf.example" "$APP_DIR/linux/kiosk.conf"
fi

echo
echo "Done. Reboot (or log out and in) so the dialout group applies; the kiosk then starts by itself."
echo "Portrait rotation and other options: $APP_DIR/linux/kiosk.conf"
echo "To start it now by hand:  $APP_DIR/linux/start-kiosk.sh"
