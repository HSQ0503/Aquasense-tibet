# Atlas Wi-Fi Pool Kit v2 setup references

Verified against official sources on 2026-10-14. These are source findings, not evidence that this hardware has been flashed, calibrated, or connected to ThingSpeak.

## Board and build

Select **Adafruit Feather ESP32-S3 TFT** from Espressif's Arduino package. The Arduino CLI FQBN is `esp32:esp32:adafruit_feather_esp32s3_tft`. This target is distinct from HUZZAH32 and Reverse TFT. [Adafruit setup](https://learn.adafruit.com/adafruit-esp32-s3-tft-feather/arduino-ide-setup)

The official board definition specifies ESP32-S3, 4 MB flash, 240 MHz CPU, QSPI PSRAM support, USB-OTG/TinyUSB, and USB CDC enabled. Its upload mode uses a 1200-baud touch. Match the selected package's board options and record the package version. Partition selection affects the upload layout and TinyUF2 preservation. [Espressif boards.txt](https://github.com/espressif/arduino-esp32/blob/master/boards.txt)

Install Ezo_I2c_lib, ThingSpeak, Adafruit GFX Library, Adafruit BusIO, and Adafruit ST7735 and ST7789 Library. `Wire`, `SPI`, and `WiFi` come from the ESP32 Arduino core. Atlas's guide identifies the display dependencies on page 13 and the board target on page 16. [Atlas setup guide](https://files.atlas-scientific.com/Wi-Fi-Pool-kit-setup-guide.pdf)

## Current Atlas sketch

Inspected revision: [`5140af60b780123e6b3c5bf0f444ceb0b6c4d4cd`](https://github.com/Atlas-Scientific/Ezo_I2c_lib/tree/5140af60b780123e6b3c5bf0f444ceb0b6c4d4cd), committed 2026-03-06.

| Circuit | I2C address | Enable GPIO | Powered state |
| --- | --- | --- | --- |
| pH | 99 / 0x63 | 12 | LOW |
| ORP | 98 / 0x62 | 11 | LOW |
| RTD | 102 / 0x66 | 9 | HIGH |
| AUX | Depends on attached circuit | 10 | LOW |
| PMP-L | 109 / 0x6D | None on port 5 | Separate port |

The S3 sketch enables TFT backlight and TFT/I2C power. The PDF's page 4 still labels its GPIO table HUZZAH32 and lists older ORP/AUX/temperature pins. Use the S3 mapping above for this target. [Pinned sketch](https://github.com/Atlas-Scientific/Ezo_I2c_lib/blob/5140af60b780123e6b3c5bf0f444ceb0b6c4d4cd/Examples/IOT_kits/pool_kit/pool_kit.ino)

The unmodified sketch attempts a 10 mL dose whenever successful pH readings are **at least 7**. It sends stop below the threshold but sends no stop when the sensor reading fails. `poll` also runs this pump path.

Invalid RTD data causes pH temperature compensation of 25 °C and sends 25 °C to ThingSpeak field 3. That value is a fallback, not a measurement. The display distinguishes missing probe from missing data.

The initial `poll_delay` expression is `2000 - 1000 * 2 - 300`, assigned to an unsigned integer. It wraps instead of producing a usable polling interval. These are code observations from the [same pinned sketch](https://github.com/Atlas-Scientific/Ezo_I2c_lib/blob/5140af60b780123e6b3c5bf0f444ceb0b6c4d4cd/Examples/IOT_kits/pool_kit/pool_kit.ino), not hardware tests.

## Serial and calibration

Atlas specifies 9600 baud and carriage return. Calibrate pH in this order: `ph:cal,mid,7`, then `ph:cal,low,4` and `ph:cal,high,10`, after readings stabilize in the matching solutions. ORP uses `orp:cal,225` with 225 mV solution. RTD calibration is optional. `rtd:cal,t` requires a known reference temperature. These commands alter calibration. [Atlas guide, pages 18–23](https://files.atlas-scientific.com/Wi-Fi-Pool-kit-setup-guide.pdf)

The command parser reads until its serial timeout, uppercases and trims input, then forwards named commands to the chosen sensor. Named commands also change the default target. `CAL` and reading commands receive a 1.2-second response delay. Send commands individually and wait for the response. [Atlas command parser](https://github.com/Atlas-Scientific/Ezo_I2c_lib/blob/5140af60b780123e6b3c5bf0f444ceb0b6c4d4cd/iot_cmd.cpp)

For passive observation, send zero bytes. Even informational serial commands change the stock sketch's polling/cloud state. Use a finite read timeout and exclusive access where supported. Avoid 1200 baud and deliberate reset/control-line changes. Setting DTR/RTS before opening reduces intentional toggles, but the OS or driver can still activate those lines on open. A serial open is therefore not a guarantee of uninterrupted device operation. [pySerial API](https://pyserial.readthedocs.io/en/latest/pyserial_api.html)

## Flash backup boundary

Espressif documents `read-flash 0 ALL backup.bin` for a complete flash read and `flash-id` for size identification. These operations do not erase or program flash. Verify the output size and hash locally. A full dump may contain Wi-Fi and API credentials, so keep it private. Secure Download Mode can prevent reads. [Espressif basic commands](https://docs.espressif.com/projects/esptool/en/latest/esp32s3/esptool/basic-commands.html)

Flash reads still require bootloader communication. By default, esptool resets the board before connecting and restarts the application afterward. `--before no-reset` still transmits synchronization bytes, so it is not passive serial listening. `--no-stub` avoids uploading a RAM helper but may require an explicit flash size. `--after no-reset` leaves the board in the bootloader. Confirm the board's current mode and account for interruption before any backup attempt. [Espressif reset and stub options](https://docs.espressif.com/projects/esptool/en/latest/esp32s3/esptool/advanced-options.html)

A flash dump covers the Feather's flash. Separate sensor calibration requires a separate record. For example, the ORP circuit supports `Cal,?` to query calibration status and `Export` to retrieve calibration data. `Cal,clear` deletes that calibration. [Atlas ORP datasheet, pages 45–46](https://files.atlas-scientific.com/ORP_EZO_Datasheet.pdf)
