import { parseFeed } from "./telemetry.ts";

export async function fetchSensorReadings(results = 100) {
  const key = process.env.THINGSPEAK_READ_API_KEY;
  if (!key) throw new Error("Sensor connection is not configured");
  const url = new URL("https://api.thingspeak.com/channels/3536852/feeds.json");
  url.searchParams.set("api_key", key);
  url.searchParams.set("results", String(results));
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Sensor service unavailable");
  const payload = await response.json() as { channel?: { id?: number }; feeds?: unknown };
  if (payload.channel?.id !== 3536852) throw new Error("Unexpected sensor channel");
  return parseFeed(payload);
}
