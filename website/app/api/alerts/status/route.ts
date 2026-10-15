import { alertStore } from "@/lib/alert-store";
import { alertRecipients } from "@/lib/alert-config";
import { alertRules } from "@/lib/alert-engine";
import { getChatGPTUser } from "../../../chatgpt-auth";
import type { AlertStatus } from "@/lib/alert-status";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const rules = { ph: alertRules.ph, temperature: alertRules.temperature, windowSeconds: alertRules.windowMs / 1000, confirmations: 2, cooldownMinutes: alertRules.cooldownMs / 60000 };

export async function GET() {
  if (process.env.VERCEL !== "1") {
    if (!(await getChatGPTUser())) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
    try {
      const response = await fetch("https://website-lake-ten-95.vercel.app/api/alerts/status", { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("Unavailable");
      return Response.json(await response.json(), { headers });
    } catch { return Response.json({ status: "unavailable", message: "Alert status could not be checked.", rules }, { status: 503, headers }); }
  }
  const base: AlertStatus = { status: "paused", message: "Email alerts are disabled.", checkedAt: null, readingAt: null, recipientCount: 0, lastAlertAt: null, lastDelivery: null, pending: 0, rules };
  if (process.env.ALERTS_ENABLED !== "true") return Response.json(base, { headers });
  try {
    base.recipientCount = alertRecipients().length;
    const stored = await alertStore().read();
    if (!stored) return Response.json({ ...base, status: "warming_up", message: "Waiting for the first background check." }, { headers });
    const state = stored.state;
    const recent = state.deliveries.at(-1);
    base.checkedAt = state.lastCheckedAt; base.readingAt = state.lastReadingAt;
    base.lastAlertAt = recent?.event.confirmed.time ?? null; base.lastDelivery = recent?.status ?? null;
    base.pending = state.deliveries.filter(d => d.status === "queued").length;
    const late = !state.lastCheckedAt || Date.now() - Date.parse(state.lastCheckedAt) > 180000;
    if (late || state.health === "error" || state.deliveries.some(d => d.status === "failed")) {
      base.status = "needs_attention"; base.message = late ? "The background check is overdue." : state.health === "error" ? "The sensor feed could not be checked." : "An alert could not be delivered. Check delivery records.";
    } else if (["stale", "no_data", "partial"].includes(state.health)) {
      base.status = "waiting"; base.message = "Waiting for complete, recent sensor readings.";
    } else if (state.health === "learning") {
      base.status = "warming_up"; base.message = "Collecting a baseline before checking for changes.";
    } else {
      base.status = "active"; base.message = "Background checks run every minute.";
    }
    return Response.json(base, { headers });
  } catch { return Response.json({ ...base, status: "unavailable", message: "Alert status could not be verified." }, { status: 503, headers }); }
}
