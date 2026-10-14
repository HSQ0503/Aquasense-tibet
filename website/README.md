# AquaSense website

Private live dashboard for Atlas Scientific Wi-Fi Pool Kit channel 3536852. Uses the Next.js App Router API through Vinext and Sites hosting. The device sends data directly to ThingSpeak, and this site reads it from the server. Neither the hosted site nor the powered kit depends on a running MacBook.

## Local development

```sh
npm install
npm run dev -- --host 127.0.0.1 --port 3314
```

Set `THINGSPEAK_READ_API_KEY` in an ignored `.dev.vars` file for local development. The deployed value is stored as a Sites runtime secret. Keep the channel read key out of frontend code, source control, screenshots, and logs. The write key and Wi-Fi password are not needed by the website.

## Behavior

- Readings refresh every 16 seconds while the tab is visible, and refresh immediately on returning to it.
- pH, ORP in millivolts, and temperature in Celsius map to channel fields 1, 2, and 3.
- History windows: 15 minutes, 1 hour, 6 hours, or 24 hours. CSV exports the selected window with UTC timestamps. Display timestamps use the viewer's local timezone.
- Missing fields remain missing. Upload gaps longer than one minute break the chart line.
- A reading older than one minute is labeled as stale. A failed request retains the last values while showing a connection error.
- ThingSpeak caches feeds larger than 100 entries. The server merges a fresh 100-entry feed into longer history so the latest values remain current. Older history may lag by up to five minutes.
- Both the page and `/api/readings` require authenticated Sites identity. The deployment is private to its owner. Do not change the audience without reviewing the data access policy.
- The website is read-only. It cannot calibrate, change Wi-Fi, or operate dosing equipment.

## Checks

```sh
npm run lint
npm test
npx tsc --noEmit
npm run build
```

Tests cover missing values, field mapping, cached/fresh feed merging, stale timestamps, and chart gaps. Browser checks cover desktop and phone layouts, metric selection, range changes, CSV export, and the station guide.

## Changing Wi-Fi later

The kit currently uses the configured home network. At the pool, confirm an internet-connected 2.4 GHz network and its credentials. Connect the kit to the Mac temporarily, update the private firmware credentials, compile and flash with explicit approval, then verify uploads before moving it back to USB power. Calibration lives on the separate EZO circuits. The current firmware does not provide a browser-based Wi-Fi setup portal or captive-portal sign-in.

ThingSpeak API references: [Read Data](https://www.mathworks.com/help/thingspeak/readdata.html), [Channel Data Control](https://www.mathworks.com/help/thingspeak/channel-control.html).
