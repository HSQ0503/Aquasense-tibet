import { getChatGPTUser } from "../../chatgpt-auth";
import { mergeReadings, parseFeed, ranges, type Range } from "@/lib/telemetry";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  if (process.env.VERCEL !== "1" && !(await getChatGPTUser())) return Response.json({ error: "Sign in to view this station." }, { status: 401, headers });
  const range = new URL(request.url).searchParams.get("range") ?? "15m";
  if (!Object.hasOwn(ranges, range)) return Response.json({ error: "Choose a supported time range." }, { status: 400, headers });
  const key = process.env.THINGSPEAK_READ_API_KEY;
  if (!key) return Response.json({ error: "The station connection has not been configured." }, { status: 503, headers });
  const minutes = ranges[range as Range];

  async function fetchFeed(results: number) {
    const url = new URL("https://api.thingspeak.com/channels/3536852/feeds.json");
    url.searchParams.set("api_key", key!);
    url.searchParams.set("results", String(results));
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("Sensor service unavailable");
    return parseFeed(await response.json());
  }

  try {
    // ThingSpeak caches feeds over 100 entries for five minutes. Merge a fresh
    // 100-entry feed so larger history views never delay the current readings.
    const [recentResult, historyResult] = await Promise.allSettled([
      fetchFeed(100),
      minutes > 15 ? fetchFeed(Math.min(8000, Math.ceil(minutes * 60 / 16) + 100)) : Promise.resolve([]),
    ]);
    if (recentResult.status !== "fulfilled") throw new Error("Current readings unavailable");
    const all = mergeReadings(historyResult.status === "fulfilled" ? historyResult.value : [], recentResult.value);
    const now = Date.now();
    return Response.json({
      latest: all.at(-1) ?? null,
      readings: all.filter(row => Date.parse(row.time) >= now - minutes * 60000 && Date.parse(row.time) <= now + 5000),
      fetchedAt: new Date(now).toISOString(),
      historyPartial: historyResult.status === "rejected",
    }, { headers });
  } catch {
    // Upstream errors can contain the authenticated URL. Return only safe copy.
    return Response.json({ error: "Couldn't reach the sensor feed. Retrying automatically." }, { status: 502, headers });
  }
}
