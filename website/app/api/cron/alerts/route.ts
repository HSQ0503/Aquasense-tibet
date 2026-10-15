import { alertRecipients, isCronAuthorized } from "@/lib/alert-config";
import { alertStore } from "@/lib/alert-store";
import { alertProvider } from "@/lib/alert-provider";
import { runMonitor } from "@/lib/alert-runner";
import { fetchSensorReadings } from "@/lib/thingspeak";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"))) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  if (process.env.VERCEL_ENV !== "production" || process.env.ALERTS_ENABLED !== "true") {
    return Response.json({ status: "disabled" }, { headers });
  }
  try {
    const provider = alertProvider();
    const result = await runMonitor({ store: alertStore(), readFeed: () => fetchSensorReadings(100), ...provider, now: () => Date.now() }, alertRecipients());
    return Response.json(result, { headers });
  } catch {
    console.error("AquaSense monitor failed; check storage, feed and email service configuration.");
    return Response.json({ error: "Monitoring check failed. The next scheduled invocation will retry." }, { status: 503, headers });
  }
}
