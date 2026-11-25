# Signifi Rotary XL Kiosk

Touch kiosk for the Signifi Rotary XL. It uses a light theme in the Signifi brand colours: red `#E32D49`, slate `#243037` and light grey `#D3DDDE`, with the Barlow Condensed and Raleway fonts.

The carousel has 12 columns, each with 10 shelves, and 3 doors. Each door has its own Alfie latch controller.

The layout is built for a **15.6" screen in portrait** (1080 × 1920; it also fits 864 × 1536 at 125 % scaling). On a landscape screen it switches to a side-by-side layout. The fonts are stored in `public/fonts`, so the kiosk works without internet.

## Install on Linux with one line (or a QR code)

Open a terminal (Ctrl+Alt+T) and run:

```
curl -fsSL https://kspatel45.github.io/rotary-xl-kiosk/install.sh | bash
```

* **QR codes:** the install page at https://kspatel45.github.io/rotary-xl-kiosk/ has one for a USB barcode scanner, which types the command into the open terminal, and one for a phone, which opens the page.
* **What it does:** downloads the kiosk to `~/rotary-kiosk`, runs the setup below, and opens the kiosk full screen.
* **Updates:** run the same line again. Your products and settings in `data/` are kept.
* **QR images:** `site/qr-install-command.png` and `site/qr-install-page.png`, ready to print.

## Manual install on Lubuntu (22.04 / 24.04)

1. Copy the `Rotary Kiosk` folder to the PC, for example to `~/rotary-kiosk`.
2. In a terminal, run the setup once:
   ```
   cd ~/rotary-kiosk
   bash linux/install-lubuntu.sh
   ```
   The setup:
   * installs Node.js and Chromium if they are missing;
   * adds you to the `dialout` group so the app can open `/dev/ttyACM*` and `/dev/ttyUSB*`;
   * removes `brltty`, which takes over CH340 USB-serial adapters (common on Arduino Mega clones);
   * starts the kiosk automatically at login.
3. Reboot. The screen rotates to portrait, the server starts, and Chromium opens full screen.

* **Rotation:** set in `linux/kiosk.conf` (`ROTATE=right`, `left`, `inverted` or `normal`). The touch screen is rotated to match.
* **Exit:** press Alt+F4 to leave the kiosk browser.
* **Logs:** `~/.cache/rotary-kiosk/server.log`.
* **Ports:** the Connection page lists them like `ttyACM0 – Arduino Mega 2560`. It saves the `/dev/serial/by-id/...` name, which stays the same after a reboot or re-plug, unlike `ttyACM0` and `ttyUSB0`, which can swap.
* `linux/start-server.sh`: starts only the server.

## Start on Windows

* `start-kiosk.bat`: starts the server and opens Chrome/Edge full screen. Exit with Alt+F4.
* `start-server.bat`: starts only the server. Then open http://localhost:8090.

Both systems need Node.js 18 or newer. There is nothing to install with npm.

## Rotary firmware v05 and calibration

Flash `firmware/RotaryXL_v05/RotaryXL_v05.ino` to the Arduino Mega. It needs the AccelStepper library, and keeps the pins, motor and encoder setup of NEMA34_TEST v04. The column angles are **not** in the firmware: the kiosk stores them and sends `GOTO <degrees>`, so re-calibrating never needs a re-flash.

| Command | Does |
|---|---|
| `HOME` | Find the Hall sensor and set 0°. |
| `GOTO <deg>` | Move to an absolute angle, the shortest way. |
| `JOG <±deg>` | Move relative, e.g. `JOG 0.5` or `JOG -10`. |
| `SPIN [rpm]` | Turn continuously; the kiosk uses this for the idle spin. |
| `STOPNEAR <a1> <a2> …` | Slow down and stop exactly on the first listed angle ahead; Order now sends the 12 column angles. |
| `STOP` | Stop where it is. |
| `POS?` | Report the position. |
| `SPEED <rpm>` | Set the GOTO/JOG speed. |

Every command ends with `Command Complete.`. Moves and position queries print `POS <commanded°> <encoder°>` just before it. Passing HOME in the homing direction no longer stops the motor: the firmware re-syncs the position instead, which corrects drift.

**To calibrate (Admin → Calibration):**
1. Pick a step size (0.1°–30°).
2. Use ◀ / ▶ to jog the carousel until a column sits exactly in front of the door. Hold an arrow to keep jogging.
3. Press **Set** on that column's row.
4. Repeat for all 12 columns, then press **Save calibration**.
5. **Go** on a row moves to that column, to check it.

The live readout shows the commanded angle and the encoder angle. If they drift apart, the motor is losing steps, or the driver's pulses-per-revolution switch setting doesn't match `motorStepsPerRev` in the firmware.

To keep using the old NEMA34_TEST v04 with its fixed C1–C12, set **Admin → Connection → Firmware** to v04.

## Machine flow

**Idle spin.** After homing, the carousel keeps turning one column after another (C1 → C2 → … → C12 → C1). The firmware has no continuous-spin command, so this is how it spins.
* **Order now:** stops the spin. The current move finishes first, so the carousel always stops on a column, the nearest one.
* **Back to the dashboard:** spinning starts again.
* **Admin:** spinning stops while Admin is open, so test commands don't collide with it.
* **Settings:** turn it off, or change the order and the pause on each column, in Admin → Connection → Rotary.
* **Crossing HOME:** a move that passes HOME is cut short there by the firmware's Hall-sensor stop. The spin carries on; a checkout move is sent once more from HOME.

1. **On COM port connect: home.**
   * Opening the port resets the Mega, so the app first waits for `System Ready.`.
   * It then sends the home command (`HOME`) and waits for `HOME COMPLETE`.
   * The dashboard shows *Homing…* and **Order now** stays disabled until the machine is *Ready*.
   * Homing also runs when the server starts with the saved ports, and from **Admin → Connection → Home now**.
2. **Dispense (checkout): bring the column to the door.**
   * The app sends `C<column>` and waits for `Command Complete.`, which the firmware prints only after the stepper has stopped.
   * It then waits the settle time, 800 ms by default.
   * On screen, the Rotary XL animation turns the same column to the door.
3. **Pop the door.**
   * The app sends Open Latch `4F <latch>` to the product's Alfie in SLCAN format, for example `t01F24F01`.
   * It waits for `73 6F <latch>` (latch opened).
4. **Door closed: back to the home page.**
   * When the Alfie reports `73 63 <latch>` (latch closed), the app shows "Thank you" for 2.5 s and returns to the dashboard.
   * If the cart has products in other columns, the carousel moves to the next column first.

## Pages

* **Dashboard**
  * Signifi header, machine status and a 3D Rotary XL showing every product: 12 columns × 10 shelves.
  * The carousel turns one column at a time, like the real machine.
  * The small gear at the bottom left opens the number pad. The admin password is **55885**.
* **Catalog**: product cards and a cart. After 90 s with no touch, the kiosk clears the cart and returns to the dashboard.
* **Vending**: the carousel turns to the column, with a door frame that shows *OPEN* or *CLOSED*, and a step list.
* **Admin**
  * **Products**: a **By category / By column** toggle at the top. The column view shows every column with its 10 shelves; empty shelves have a **+ Add here** button. Each product has a name, image link, price, category and location. The location is the rotary column (C1–C12), the shelf (1–10, where it appears on the display), the Alfie door (1–3) and the latch.
  * **Connection**: COM port, baud rate and line ending for the Arduino and the USB-CAN adapter. Also the home command, home on connect, Home now, and the SLCAN init commands. The default init is `C`, `S2`, `O`: close, 50 kbit/s, open, the same as VendingPoC.
  * **Alfie doors**: name, Group ID and DIP address of the 3 Alfies. CAN ID = (group << 9) | (address << 4) | 0xF.
  * **Test & Log**: rotate to a column, open or query a latch, send raw lines, and watch the live serial log.

Data is saved in `data/store.json`.

## Demo catalog: 120 products

The catalog fills all 12 columns × 10 shelves, with one category per column:

* C1 Mice & keyboards
* C2 Audio
* C3 Charging
* C4 Cables
* C5 Storage
* C6 Hubs & adapters
* C7 Laptop accessories
* C8 Phone & tablet
* C9 Video & presenting
* C10 Power
* C11 Desk & bags
* C12 Care & extras

* **Images:** every product has a reference image in `public/img/products/`. They are SVG illustrations in Signifi colors, stored in the app so they work offline.
* **Your own photos:** in **Admin → Products → Edit**, paste a photo link (`https://…`) or a path such as `img/products/mouse-black.svg`.
* **Location:** latch number = shelf number. The Alfie door is 1, 2, 3, 1, 2, 3 … by column. Change any of these in Admin if your wiring is different.
* **Catalog page:** category buttons filter the list.
* **Change the demo list:** edit `tools/build-catalog.js`, then run `node tools/build-catalog.js`. It rewrites `demo-products.json`, which is used when `data/store.json` does not exist.

## Simulation mode

Simulation mode is ON by default. The server answers like the NEMA34 firmware and the Alfies, so the whole flow can be tested without hardware. To use the real machine, turn it off in Admin → Connection, pick the COM ports and press **Connect**.
