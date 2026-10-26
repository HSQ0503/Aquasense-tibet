"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertPanel } from "./alert-panel";
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Check, ChevronDown, Download, Droplets, Info, RefreshCw, ShieldCheck, Thermometer, Waves, Wifi, Zap } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartReadings, isRecent, ranges, type Metric, type Range, type Reading, type Telemetry } from "@/lib/telemetry";

// minSpan keeps sensor noise from looking dramatic when the window is nearly flat.
const metrics = {
  ph: { name: "pH", label: "Acidity / alkalinity", unit: "pH", decimals: 2, color: "#7cb4f0", icon: Droplets, minSpan: 0.3 },
  orp: { name: "ORP", label: "Oxidation-reduction", unit: "mV", decimals: 0, color: "#e3b56b", icon: Zap, minSpan: 20 },
  temperature: { name: "Temperature", label: "Water temperature", unit: "°C", decimals: 2, color: "#5fd0b0", icon: Thermometer, minSpan: 1 },
} as const;
const metricKeys = Object.keys(metrics) as Metric[];
const rangeLabels: Record<Range, string> = { "15m": "15 min", "1h": "1 hour", "6h": "6 hours", "24h": "24 hours" };

function formatValue(value: number | null | undefined, metric: Metric) {
  return value == null ? "—" : value.toFixed(metrics[metric].decimals);
}
function formatChange(change: number | null, metric: Metric) {
  if (change == null) return "—";
  const rounded = Number(change.toFixed(metrics[metric].decimals));
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : "±"}${Math.abs(rounded).toFixed(metrics[metric].decimals)}`;
}
function clock(time: string | number, seconds = false) {
  return new Date(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) });
}
function ageLabel(time: string | undefined, now: number) {
  if (!time || !now) return "Waiting for a reading";
  const seconds = Math.max(0, Math.floor((now - Date.parse(time)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
function downloadCsv(readings: Reading[]) {
  const rows = [["Timestamp (UTC)", "pH", "ORP (mV)", "Temperature (C)"],
    ...readings.map(row => [row.time, row.ph ?? "", row.orp ?? "", row.temperature ?? ""])];
  const url = URL.createObjectURL(new Blob([rows.map(row => row.join(",")).join("\n")], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url; link.download = "aquasense-readings.csv"; link.click(); URL.revokeObjectURL(url);
}
function metricValues(readings: Reading[], metric: Metric) {
  return readings.flatMap(row => row[metric] == null ? [] : [row[metric]]);
}
function niceStep(rough: number) {
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  return ([1, 2, 2.5, 5, 10].find(factor => factor * magnitude >= rough) ?? 10) * magnitude;
}
function chartTicks(low: number | null, high: number | null, metric: Metric) {
  if (low === null || high === null) return [0, 1];
  const span = Math.max((high - low) * 1.4, metrics[metric].minSpan);
  const middle = (low + high) / 2;
  const step = niceStep(span / 4);
  const start = Math.floor((middle - span / 2) / step) * step;
  const end = Math.ceil((middle + span / 2) / step) * step;
  return Array.from({ length: Math.round((end - start) / step) + 1 }, (_, index) => Number((start + index * step).toFixed(4)));
}

export function Dashboard({ publicReadings = false }: { publicReadings?: boolean }) {
  const [range, setRange] = useState<Range>("15m");
  const [metric, setMetric] = useState<Metric>("ph");
  const [snapshot, setSnapshot] = useState<{ range: Range; data: Telemetry } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [now, setNow] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [view, setView] = useState<"live" | "setup">("live");
  const data = snapshot?.range === range ? snapshot.data : null;
  const latest = snapshot?.data.latest;
  const live = !error && isRecent(latest?.time, now);
  const selected = metrics[metric];
  const readings = data?.readings ?? [];
  const chart = useMemo(() => chartReadings(data?.readings ?? []), [data]);
  const values = metricValues(readings, metric);
  const low = values.length ? Math.min(...values) : null;
  const high = values.length ? Math.max(...values) : null;
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const ticks = chartTicks(low, high, metric);
  const status = error ? "Connection interrupted" : !latest ? (busy ? "Connecting" : "Waiting for readings") : live ? "Live" : "No recent readings";

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let controller: AbortController | undefined;
    async function load() {
      if (inFlight || document.hidden) return;
      inFlight = true; controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 20000);
      setBusy(true);
      try {
        const response = await fetch(`/api/readings?range=${range}`, { cache: "no-store", signal: controller.signal });
        const payload = (await response.json()) as Telemetry & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Couldn't load readings. Retrying automatically.");
        if (!disposed) { setSnapshot({ range, data: payload }); setError(null); setNow(Date.now()); }
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error && cause.name !== "AbortError" ? cause.message : "The connection timed out. Retrying automatically.");
      } finally {
        clearTimeout(timeout); inFlight = false;
        if (!disposed) setBusy(false);
      }
    }
    void load();
    const interval = setInterval(() => void load(), 16000);
    const onVisible = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { disposed = true; controller?.abort(); clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, [range, refresh]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href="/" aria-label="AquaSense home"><span className="brand-icon"><Waves size={18} /></span>AquaSense</Link>
          <nav aria-label="Main navigation"><button className={view === "live" ? "active" : ""} onClick={() => setView("live")}>Live readings</button><button className={view === "setup" ? "active" : ""} onClick={() => setView("setup")}>Station guide</button></nav>
          <span className="private-badge"><ShieldCheck size={14} />{publicReadings ? "Public station" : "Private station"}</span>
        </div>
      </header>

      <main className="page-wrap">
        {view === "setup" ? <StationGuide /> : <>
          <section className="page-heading">
            <div>
              <p className="eyebrow">Tibet Butler Sensor <span aria-hidden="true">·</span> Station 3536852</p>
              <h1>Water monitoring</h1>
            </div>
            <div className="connection-state">
              <span role="status" className={`status-pill ${live ? "live" : "waiting"}`}><span className="status-dot" />{status}</span>
              <span className="muted">{latest ? `Updated ${ageLabel(latest.time, now)}` : "Waiting for a reading"}</span>
            </div>
          </section>

          {error && <div className="notice" role="alert"><Info size={18} /><div>{error} {latest && "Showing the last received values."}{!publicReadings && <a href="/signin-with-chatgpt?return_to=%2F" target="_top">Sign in again</a>}</div></div>}
          {!error && latest && !live && <div className="notice"><Wifi size={18} /><span>No new reading for over a minute. Check the kit’s power and Wi-Fi, or send <code>datalog</code> if calibration paused uploads.</span></div>}

          <section className="measurements" aria-label="Latest sensor readings">
            {metricKeys.map(key => {
              const config = metrics[key]; const Icon = config.icon;
              const series = metricValues(readings, key);
              const change = series.length > 1 ? series[series.length - 1] - series[0] : null;
              const TrendIcon = change == null || Math.abs(change) < 10 ** -config.decimals ? ArrowRight : change > 0 ? ArrowUpRight : ArrowDownRight;
              return <button key={key} className={`measurement ${metric === key ? "selected" : ""}`} style={{ "--metric": config.color } as React.CSSProperties} onClick={() => setMetric(key)} aria-pressed={metric === key} aria-label={`Show ${config.name} trend`}>
                <div className="measurement-top">
                  <span className="measurement-name"><span className="metric-icon"><Icon size={15} /></span>{config.name}</span>
                  <span className="measurement-label">{latest?.[key] == null ? "No measurement" : config.label}</span>
                </div>
                <div className="measurement-value">{formatValue(latest?.[key], key)}<span>{config.unit}</span></div>
                <div className="measurement-footer">
                  <span className="measurement-change"><TrendIcon size={14} /><strong>{formatChange(change, key)}</strong> in {rangeLabels[range]}</span>
                  <Sparkline values={series} minSpan={config.minSpan} />
                </div>
              </button>;
            })}
          </section>

          <div className="main-grid">
            <section className="chart-panel panel" style={{ "--metric": selected.color } as React.CSSProperties}>
              <div className="panel-heading">
                <div><h2>{selected.name} trend</h2><p>Last {rangeLabels[range]} <span className="separator">·</span> {values.length} readings</p></div>
                <div className="range-picker" role="group" aria-label="Chart time range">{(Object.keys(ranges) as Range[]).map(key => <button key={key} onClick={() => setRange(key)} aria-pressed={range === key}>{key}</button>)}</div>
              </div>
              <dl className="chart-stats">
                <div><dt>Latest</dt><dd>{formatValue(latest?.[metric], metric)}<span>{selected.unit}</span></dd></div>
                <div><dt>Average</dt><dd>{formatValue(average, metric)}<span>{selected.unit}</span></dd></div>
                <div><dt>Low</dt><dd>{formatValue(low, metric)}<span>{selected.unit}</span></dd></div>
                <div><dt>High</dt><dd>{formatValue(high, metric)}<span>{selected.unit}</span></dd></div>
              </dl>
              <div className="chart-container" role="img" aria-label={`${selected.name} chart for the last ${rangeLabels[range]}. Values are also available in the readings table and CSV export.`}>
                {values.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs><linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={selected.color} stopOpacity={0.28} /><stop offset="100%" stopColor={selected.color} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid stroke="#1f2c3a" vertical={false} />
                  <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} tickFormatter={value => clock(Number(value))} tick={{ fill: "#8293a6", fontSize: 12 }} axisLine={{ stroke: "#26354a" }} tickLine={false} minTickGap={70} tickMargin={10} />
                  <YAxis domain={[ticks[0], ticks[ticks.length - 1]]} ticks={ticks} tick={{ fill: "#8293a6", fontSize: 12 }} tickFormatter={value => Number(value).toFixed(selected.decimals)} axisLine={false} tickLine={false} width={52} />
                  <Tooltip contentStyle={{ background: "#0f1824", border: "1px solid #2a3a4f", borderRadius: 8, color: "#e8eef5", fontSize: 13, boxShadow: "0 8px 24px rgba(0,0,0,.4)" }} labelStyle={{ color: "#8293a6", marginBottom: 4 }} labelFormatter={value => clock(Number(value), true)} formatter={value => [value == null ? "Missing" : `${Number(value).toFixed(selected.decimals)} ${selected.unit}`, selected.name]} cursor={{ stroke: "#3c4f66", strokeDasharray: "4 4" }} />
                  <Area type="monotone" dataKey={metric} stroke={selected.color} strokeWidth={2} fill={`url(#fill-${metric})`} connectNulls={false} dot={values.length === 1 ? { r: 4, fill: selected.color } : false} activeDot={{ r: 5, strokeWidth: 2, stroke: "#0f1824" }} isAnimationActive={false} />
                </AreaChart></ResponsiveContainer> : <div className="chart-empty"><Activity size={28} /><h3>{busy ? "Loading sensor history" : "No measurements in this window"}</h3><p>{busy ? "Connecting to your station’s feed…" : "Try a longer time range, or check the kit’s power and Wi-Fi."}</p></div>}
              </div>
              <div className="chart-caption"><span><span className="legend-dot" />Measured {metric === "temperature" ? "temperature" : selected.name}</span><span>Gaps indicate missing readings</span></div>
              {data?.historyPartial && <p className="history-warning">Some history couldn’t load. Current readings are available.</p>}
            </section>

            <AlertPanel refresh={refresh} />
          </div>

          <section className="table-panel panel">
            <div className="panel-heading">
              <div><h2>Recent readings</h2><p>Latest entries in this window, in your local time.</p></div>
              <button className="secondary-button" onClick={() => downloadCsv(readings)} disabled={!readings.length}><Download size={15} />Export CSV</button>
            </div>
            <div className="table-scroll"><table>
              <thead><tr><th scope="col">Recorded at</th><th scope="col">pH</th><th scope="col">ORP <span>mV</span></th><th scope="col">Temp <span>°C</span></th><th scope="col">Entry</th></tr></thead>
              <tbody>
                {readings.slice(-8).reverse().map(row => <tr key={row.id}><td>{clock(row.time, true)}</td><td>{formatValue(row.ph, "ph")}</td><td>{formatValue(row.orp, "orp")}</td><td>{formatValue(row.temperature, "temperature")}</td><td className="muted">#{row.id}</td></tr>)}
                {!readings.length && <tr><td colSpan={5} className="empty-row">{busy ? "Loading readings…" : "No readings in this time window."}</td></tr>}
              </tbody>
            </table></div>
          </section>
          <div className="data-note"><Info size={14} /><p>Measurements support on-site checks; they do not establish animal safety. Pause alerting before moving, cleaning, or calibrating the probes.</p></div>
        </>}
        <footer className="page-footer"><span><Waves size={14} />AquaSense <span className="footer-separator">/</span> Atlas Scientific Wi-Fi Pool Kit</span><button onClick={() => setRefresh(value => value + 1)} disabled={busy} className="refresh-button"><RefreshCw size={14} className={busy ? "spinning" : ""} />{busy ? "Updating" : "Refresh now"}</button></footer>
      </main>
    </div>
  );
}

function Sparkline({ values, minSpan }: { values: number[]; minSpan: number }) {
  if (values.length < 2) return <span className="sparkline" />;
  const step = Math.max(1, Math.floor(values.length / 60));
  const points = values.filter((_, index) => index % step === 0 || index === values.length - 1);
  const low = Math.min(...points); const high = Math.max(...points);
  const spread = Math.max(high - low, minSpan);
  const floor = (low + high - spread) / 2;
  const path = points.map((value, index) => `${(index / (points.length - 1)) * 100},${28 - ((value - floor) / spread) * 26}`).join(" ");
  return <svg className="sparkline" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points={path} /></svg>;
}

function StationGuide() {
  return <div className="setup-view"><section className="page-heading"><div><p className="eyebrow">Tibet Butler Sensor <span aria-hidden="true">·</span> Station 3536852</p><h1>Station guide</h1><p className="heading-note">Network connection, alert rules, and probe maintenance.</p></div><span className="status-pill live"><Check size={14} />pH and ORP calibrated</span></section>
    <div className="guide-grid"><section className="panel guide-panel"><Wifi className="guide-icon" /><h2>Power and connection</h2><p>The kit connects to its configured Wi-Fi automatically after power-on. It can also renew the specifically approved guest portal session.</p><ul><li>Use the kit’s USB connection with a suitable power adapter.</li><li>Your MacBook is only needed for programming or serial calibration.</li><li>Open this website on your phone or computer to check readings.</li></ul></section>
    <section className="panel guide-panel"><Waves className="guide-icon" /><h2>Changing networks</h2><ol><li>Get the pool’s <strong>2.4 GHz Wi-Fi name</strong> and any required password.</li><li>Connect the kit to your Mac once so we can update its Wi-Fi credentials.</li><li>Verify fresh readings here, then move the USB cable to its power adapter.</li></ol><p className="guide-note">The configured guest portal is supported. Other sign-in pages need inspection first. If the approved disclaimer changes, automatic acceptance pauses.</p></section></div>
    <section className="panel guide-panel"><h2>Know what the status means</h2><div className="status-explainer"><div><span className="status-pill live"><span className="status-dot" />Live</span><p>A reading arrived within the last minute. New measurements are normally uploaded about every 16 seconds.</p></div><div><span className="status-pill waiting"><span className="status-dot" />No recent readings</span><p>The last reading is older than a minute. Check power, Wi-Fi, or whether <code>poll</code> mode paused uploads. The last values stay visible with their age.</p></div></div></section>
    <section className="panel guide-panel"><h2>Rapid-change email alerts</h2><p>The background monitor checks once per minute for a change of at least 0.5 pH units or 2°C within two minutes. A second consecutive reading must confirm the change. The reference is the median of three earlier readings.</p><p>Repeated alerts for the same sensor are suppressed for 15 minutes unless a further change of at least 1.0 pH unit or 4°C occurs. Missing readings, stale data, and gaps in transmission do not generate change alerts. The monitor learns a new baseline after a gap.</p><p>These are operational warning rules, not species-specific lethal limits. Staff should inspect the enclosure and verify unexpected measurements. Ask the operator to disable alerts before probe handling, cleaning, or calibration; the public dashboard cannot change alert settings.</p></section>
    <details className="panel guide-panel"><summary>Calibration and maintenance <ChevronDown size={18} /></summary><div className="details-content"><p>pH was calibrated at 7.00, 4.00, and 10.00. ORP was calibrated in 225 mV reference solution on October 14, 2026. The temperature probe retains its existing calibration.</p><p>For later calibration, connect USB serial at 9600 baud with carriage-return line endings. Use <code>poll</code> to pause uploads and observe readings, then <code>datalog</code> to resume. Only send calibration commands while the correct probe is stable in the matching reference solution.</p><p>Rinse probes between solutions and return them to the appropriate storage solution when finished. This dashboard is read-only and cannot dose chemicals or change calibration.</p></div></details>
  </div>;
}
