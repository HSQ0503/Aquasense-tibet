# AquaSense pool kit

Atlas Scientific Wi-Fi Pool Kit v2 firmware for the Adafruit Feather ESP32-S3 TFT. Channel 3536852 uses field 1 for pH, field 2 for ORP in mV, and field 3 for temperature in Celsius.

## Local setup

- macOS 26.6.2, Apple Silicon.
- Arduino CLI 1.5.1: `.tools/arduino-cli`.
- Espressif ESP32 core 3.3.12.
- FQBN: `esp32:esp32:adafruit_feather_esp32s3_tft:PartitionScheme=tinyuf2`.
- Detected board: Feather ESP32-S3 TFT. The device identity is recorded in the private local setup receipt.
- Observed port: `/dev/cu.usbmodem1101`. Verify it again after reconnecting.
- Atlas source: `vendor/Ezo_I2c_lib`, commit `5140af60b780123e6b3c5bf0f444ceb0b6c4d4cd`.
- Working sketch: `firmware/pool_kit/pool_kit.ino`.
- Credentials: ignored `firmware/pool_kit/secrets.h` and `.private/credentials.json`.

Checked against the attached Atlas v2 manual on October 14, 2026: the board options match the page 17 screenshot, including 240 MHz CPU, QIO 80 MHz, 4 MB flash, TinyUF2 with two application slots, QSPI PSRAM, TinyUSB, CDC enabled, debug level None, and erase-all disabled. The generated partition table also matches the original device's table byte for byte. Page 4 contains an older HUZZAH32 GPIO table, so the working sketch retains the official ESP32-S3 firmware's sensor pins. The manual states that Atlas tested these instructions on Windows, not macOS. This setup uses Arduino CLI in place of the IDE menus.

Wi-Fi credentials and the ThingSpeak write key become part of the compiled firmware stored on the device. Build outputs, flash backups, and credential files are excluded from Git. Do not share these files.

## Build

From this directory:

```sh
.tools/arduino-cli compile \
  --fqbn esp32:esp32:adafruit_feather_esp32s3_tft:PartitionScheme=tinyuf2 \
  --library vendor/Ezo_I2c_lib \
  --build-path .build firmware/pool_kit
```

Libraries: ThingSpeak 2.1.1, Adafruit GFX 1.12.6, Adafruit BusIO 1.17.4, Adafruit ST7735/ST7789 1.11.0. The Atlas library is supplied through `--library`.

## Firmware changes

The sketch retains the manufacturer's TFT rendering, I2C sequence, pin assignments for pH/ORP/RTD, and serial calibration commands. Pump commands and the pump device are removed, and the auxiliary circuit is disabled. Sensor polling takes about three seconds, fixing the original unsigned delay underflow. Cloud writes occur every 16 seconds after each completed request.

Empty, malformed, nonfinite, or failed readings are omitted. Temperature outside -200 to 850 C is also rejected. An invalid RTD reading displays `no data` and leaves ThingSpeak field 3 missing. The manufacturer's 25 C fallback is used only for pH compensation and is identified in serial output and channel status.

## Backup and upload status

A complete 4,194,304-byte Feather flash backup is saved privately at `.private/original-flash.bin`. SHA-256:

```text
8e55ba4d831b4e1611ec5ddfe29ca0cd69779d89d012fc743903aba43a96f0fb
```

The original partition layout is TinyUF2 4 MB with two 1,408 KiB application slots. The original application descriptor reports version `afa5cdd`, built July 22, 2025, with ESP-IDF `v5.5-1-gb66b5448e0`. This descriptor does not establish the Atlas sketch revision. The prepared sketch compiles successfully (998,043 bytes, 69% of the application slot). The generated partition table matches the original byte for byte, and the full flash backup was verified against the device by digest. Firmware uploaded on October 14, 2026 with explicit approval. Esptool verified each written region by hash. The board booted and all three sensors returned measurements. Han confirmed that the TFT shows pH, ORP, and RTD rows.

The backup does not contain calibration stored on the separate EZO circuits. Restore has not been tested. The approved upload preserved the NVS and filesystem regions. Future firmware uploads require explicit approval. Do not erase all flash or NVS.

## Verified live readings

ThingSpeak entries 1, 2, and 3 were read back through its private API, 16 seconds apart. The latest was October 14, 2026 at 2:51:18 PM EDT: pH 4.32, ORP 177 mV, temperature 25.47 C. Serial output showed matching physical sensor measurements and three successful upload results. These readings precede the guided pH calibration.

Three-point pH calibration is complete. Each write was explicitly approved: midpoint 7.00, low point 4.00, then high point 10.00. The sensor reported `?CAL,1`, `?CAL,2`, and finally `?CAL,3`. Readings after the high-point calibration were 9.99 and 10.01 in pH 10.00 buffer. Movement between solutions caused transient readings after the low point. Cloud uploads have been resumed with `datalog`. The private API confirmed entry 5 at October 14, 2026, 03:04:38 PM EDT: pH 7.75, ORP 184 mV, RTD 23.96 C. These are sensor readings during the transition out of calibration, not a confirmed pool-water sample.

ORP was calibrated with explicit approval in 225 mV reference solution using `orp:cal,225`. The sensor confirmed `?CAL,1`, and subsequent readings were 224.9, 225.1, and 225.2 mV in that solution. After resuming `datalog`, ThingSpeak entry 13 was verified at 03:07:39 PM EDT. RTD calibration was not performed and is optional under the Atlas manual. Calibration persistence across a physical power cycle has not been independently tested during this setup.

## Serial monitor and pH calibration

Close other serial programs before opening the monitor:

```sh
.tools/venv/bin/python -m serial.tools.miniterm /dev/cu.usbmodem1101 9600 --eol CR
```

Exit with Control-]. Any command pauses cloud uploads. `poll` resumes sensor readings without cloud writes. `datalog` resumes both.

Perform calibration only when ready to use the buffer solutions. Keep the probe in its recommended storage solution until then. Follow the probe manufacturer's handling guidance.

1. Enter `poll`. Rinse the pH probe with distilled or deionized water. Place the sensing tip in fresh pH 7.00 buffer and gently move it to release trapped bubbles.
2. Wait until several consecutive pH readings settle, normally about 1-2 minutes according to page 21. Confirm stability before sending `ph:cal,mid,7`. Check for a successful response, then enter `poll` again.
3. Rinse the probe. Place it in fresh pH 4.00 buffer. Wait for stable readings, then send `ph:cal,low,4`. Check the response and enter `poll` again.
4. Rinse the probe. Place it in fresh pH 10.00 buffer. Wait for stable readings, then send `ph:cal,high,10`.
5. Check calibration with `ph:cal,?`, expecting three calibration points. Rinse the probe, return it to the intended sample or proper storage solution, and enter `datalog` to resume uploads.

Do not send `ph:cal,clear`. Calibration is stored on the pH circuit and survives power cycles. These commands remain available later without reinstalling tools or firmware. During guided calibration, wait for instructions and a stability check at each buffer.

Open each calibration pouch only when ready to use it. Atlas says solution in an open pouch is no longer considered accurate after 20 minutes and instructs disposal of the remaining solution after calibration. Temperature calibration is optional (page 23). If pH readings will not stabilize while ORP and temperature stay steady, page 25 suggests testing with the laptop running on battery to check for USB power noise.

## Next.js integration

Keep `THINGSPEAK_READ_API_KEY` in a server-only environment variable. Do not prefix it with `NEXT_PUBLIC_`. A server component or route handler can fetch:

```text
https://api.thingspeak.com/channels/3536852/feeds/last.json?api_key=READ_API_KEY
```

Use `cache: 'no-store'`, return only `created_at`, `entry_id`, and the three fields, and convert non-null numeric strings to numbers. Preserve null fields as missing measurements. Show the timestamp so old readings are visible. Never send the API key or the authenticated ThingSpeak URL to browser code.

See [SETUP-REFERENCES.md](SETUP-REFERENCES.md) for official firmware, board, backup, and calibration references.

## Website

The private dashboard is deployed at [AquaSense](https://aquasense-han.hsq0503.chatgpt.site). Source is in `website/`. It refreshes every 16 seconds with pH, ORP, temperature, timestamps, selectable history, and CSV export. Its server uses the ThingSpeak read key stored as a runtime secret, and both the page and API require sign-in on ChatGPT Sites. The Vercel deployment is intentionally public, with its read key kept server-side.

Standalone operation was verified on October 14, 2026: the Mac no longer detected the kit on USB, and ThingSpeak entries 47, 48, and 49 arrived 16 seconds apart while the kit ran from its USB power adapter. The Mac does not need to remain at the pool.

The pool network must be configured on the kit before deployment there. Keep its 2.4 GHz network name and password private, update the ignored firmware credentials, and obtain explicit approval before flashing. The website address and ThingSpeak channel can stay the same.

## Recreating the local firmware build

Install Arduino CLI and the ESP32 3.3.12 core, then install the library versions listed above. Clone the Atlas library into the ignored vendor directory and check out the pinned revision:

```sh
git clone https://github.com/Atlas-Scientific/Ezo_I2c_lib.git vendor/Ezo_I2c_lib
git -C vendor/Ezo_I2c_lib checkout 5140af60b780123e6b3c5bf0f444ceb0b6c4d4cd
```

Copy `firmware/pool_kit/secrets.example.h` to `firmware/pool_kit/secrets.h` and fill in local credentials. Build with the FQBN above. The signed-in website uses its own read-only API key, configured separately.
