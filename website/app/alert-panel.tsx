"use client";

import { useEffect, useState } from "react";
import { Bell, CircleCheck, CircleAlert } from "lucide-react";
import type { AlertStatus } from "@/lib/alert-status";

const labels = { active: "Active", warming_up: "Collecting baseline", paused: "Paused", needs_attention: "Needs attention", waiting: "Waiting for data", unavailable: "Status unavailable" };

export function AlertPanel({ refresh }: { refresh: number }) {
  const [status, setStatus] = useState<AlertStatus | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();
    async function load() {
      if (document.hidden) return;
      try {
        const response = await fetch("/api/alerts/status", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
        if (!response.ok) throw new Error("Status unavailable");
        const data = await response.json() as AlertStatus;
        if (!stopped) { setStatus(data); setFailed(false); }
      } catch { if (!stopped) setFailed(true); }
    }
    void load();
    const timer = setInterval(() => void load(), 60000);
    const onVisible = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);
  const active = !failed && status?.status === "active";
  const title = failed ? "Status unavailable" : status ? labels[status.status] : "Checking status";
  const rules = status?.rules;
  return <aside className="alerts-panel panel" aria-label="Email alert monitoring">
    <div className="alerts-heading"><h2><Bell size={16} />Email alerts</h2><span className={`alert-monitor-status ${active ? "active" : "pending"}`} role="status">{active ? <CircleCheck size={14} /> : <CircleAlert size={14} />}{title}</span></div>
    <p className="alert-description">{failed ? "Monitoring status could not be verified. Refresh to try again." : status?.message ?? "Checking the background monitor."}</p>
    <dl className="alert-rules"><div><dt>pH change</dt><dd>≥ {rules?.ph ?? 0.5}</dd></div><div><dt>Temperature change</dt><dd>≥ {rules?.temperature ?? 2}°C</dd></div><div><dt>Time window</dt><dd>2 minutes</dd></div><div><dt>Confirmation</dt><dd>2 readings</dd></div></dl>
    <div className="alert-delivery"><span>Notifications</span><strong>{status?.recipientCount ? `${status.recipientCount} staff recipients` : "Not yet verified"}</strong></div>
    <p className="alert-footnote">Checks run with the website closed. These are change-detection rules, not lethal thresholds for animals.</p>
    {status?.checkedAt && <div className="monitor-time">Last check {new Date(status.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>}
    {status?.lastAlertAt && <div className="last-alert">Last alert: {new Date(status.lastAlertAt).toLocaleString()}<br />{status.lastDelivery === "delivered" ? "All recipient deliveries confirmed" : status.lastDelivery === "sent" ? "Accepted by email provider" : status.lastDelivery === "queued" ? "Delivery pending" : "Delivery needs attention"}</div>}
  </aside>;
}
