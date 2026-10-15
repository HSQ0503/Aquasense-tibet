# AquaSense website

Live dashboard for Atlas Scientific Wi-Fi Pool Kit channel 3536852. Uses native Next.js on Vercel and Vinext on ChatGPT Sites. The device sends data directly to ThingSpeak, and this site reads it from the server. Neither the hosted site nor the powered kit depends on a running MacBook.

## Local development

```sh
npm install
npm run dev -- --host 127.0.0.1 --port 3314
```

Set `THINGSPEAK_READ_API_KEY` in an ignored `.dev.vars` file for local development. The deployed value is stored as a runtime secret in each hosting provider. Keep the channel read key out of frontend code, source control, screenshots, and logs. The write key and Wi-Fi password are not needed by the website.

## Behavior

- Readings refresh every 16 seconds while the tab is visible, and refresh immediately on returning to it.
- pH, ORP in millivolts, and temperature in Celsius map to channel fields 1, 2, and 3.
- History windows: 15 minutes, 1 hour, 6 hours, or 24 hours. CSV exports the selected window with UTC timestamps. Display timestamps use the viewer's local timezone.
- Missing fields remain missing. Upload gaps longer than one minute break the chart line.
- A reading older than one minute is labeled as stale. A failed request retains the last values while showing a connection error.
- ThingSpeak caches feeds larger than 100 entries. The server merges a fresh 100-entry feed into longer history so the latest values remain current. Older history may lag by up to five minutes.
- ChatGPT Sites requires authenticated identity for both the page and `/api/readings`. On Vercel (`VERCEL=1`), readings are intentionally public. Vercel preview deployments remain protected by the platform, while the production domain is public.
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

The kit currently uses the configured home network. At the pool, confirm an internet-connected 2.4 GHz network and its credentials. Connect the kit to the Mac temporarily, update the private firmware credentials, compile and flash with explicit approval, then verify uploads before moving it back to USB power. Calibration lives on the separate EZO circuits. The firmware supports the specifically approved captive portal and checks its disclaimer fingerprint before acceptance. Other portals require inspection and explicit approval. It does not provide a browser-based Wi-Fi setup screen.

ThingSpeak API references: [Read Data](https://www.mathworks.com/help/thingspeak/readdata.html), [Channel Data Control](https://www.mathworks.com/help/thingspeak/channel-control.html).

## Vercel deployment

The connected GitHub project uses `website` as its Root Directory and Next.js as its framework. `vercel.json` selects `npm run build:vercel`, which runs native `next build` and verifies the required route manifests in `.next`. `npm run build` remains the Vinext build used for ChatGPT Sites.

Set `THINGSPEAK_READ_API_KEY` as an encrypted server environment variable in Vercel production and preview environments. Vercel supplies `VERCEL=1`, which selects public access and removes the ChatGPT sign-in dependency. The same code reads environment variables through `process.env`, supported by both Node.js and the Sites Workers runtime.

Run the native production build locally with:

```sh
npm run build:vercel
VERCEL=1 npm run start:vercel
```

Provide the read key through a private environment variable or an ignored `.env.local` file for native Next.js. Do not add it to `next.config.ts`, a `NEXT_PUBLIC_` variable, or source code.

## Background email alerts

Vercel Cron calls `/api/cron/alerts` once per minute. It requires an exact bearer `CRON_SECRET` and only sends when `VERCEL_ENV=production` and `ALERTS_ENABLED=true`. Keep `RESEND_API_KEY`, `CRON_SECRET`, and `ALERT_RECIPIENTS` in encrypted production environment variables. `ALERT_RECIPIENTS` is a JSON array; recipient addresses are not published in the source or status endpoint. The sender is `AquaSense <alerts@urso.ws>`.

The rules in `lib/alert-engine.ts` detect an absolute pH change of at least 0.5 or a temperature change of at least 2 C within two minutes. A second consecutive reading must confirm the same direction and threshold. The reference uses the median of three earlier readings. A transmission gap over 45 seconds resets that sensor's baseline; missing values, readings older than 90 seconds, and future timestamps cannot trigger a change alert. Initial activation seeds the current baseline without sending historical alerts.

A 15-minute cooldown per sensor suppresses repeat notifications. A further difference of at least 1.0 pH unit or 4 C from the last reported value bypasses that cooldown. These are provisional operational warning rules, not validated lethal thresholds for alligators. The [GFAS crocodilian standards](https://sanctuaryfederation.org/wp-content/uploads/2020/02/Crocodilian-Standards-2019.pdf), H-8 and N-1, call for species-appropriate temperature and water quality. They do not define these rate-of-change limits. The animal-care team should set any species-specific absolute limits.

`aquasense/monitor-v1.json` in the private Vercel Blob store holds the reading cursor, candidate changes, a two-minute lease, and the email outbox. Consistent reads and ETag conditional writes prevent overlapping checks from racing. Events and immutable email payloads are persisted before sending. Resend batch idempotency keys prevent retries from sending duplicate mail. Transient errors retry up to three times per invocation and again on later cron invocations; queued messages expire after 15 minutes to avoid delivering old emergencies as current. Permanent send errors and bounced/suppressed deliveries appear as needing attention.

The monitor polls Resend receipts after provider acceptance. `sent` means accepted by Resend; `delivered` means every recipient's mail server accepted the email, not that someone read it. `/api/alerts/status` exposes only health, timing, rules and recipient count. It never exposes addresses, messages, storage credentials or API keys. The private ChatGPT Site reads this sanitized status from the Vercel service; it does not run a second sender.

Disable `ALERTS_ENABLED` and redeploy before probe handling, calibration, or cleaning. Return the probes to the monitored water and allow at least two minutes of stable readings before re-enabling. Email and public Wi-Fi are best-effort monitoring components and do not replace on-site animal-care procedures.

Validation includes detection fixtures, stale/missing data, duplicate invocations, concurrent leases, outbox-before-send ordering, permanent failures, and uncertain-result retries. A separate integration check verifies private storage conditional writes, Resend idempotency, and simulated delivery using `delivered@resend.dev`. Real staff inbox delivery is not tested by that simulated address.
