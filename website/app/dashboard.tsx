"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertPanel } from "./alert-panel";
import { Check, ChevronDown, Download, Info, RefreshCw, Waves, Wifi } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartReadings, isRecent, ranges, type Metric, type Range, type Reading, type Telemetry } from "@/lib/telemetry";

// minSpan keeps sensor noise from looking dramatic when the window is nearly flat.
const metrics = {
  ph: { name: "pH", label: "Acidity", unit: "", decimals: 2, color: "#8ab4ff", minSpan: 0.3 },
  orp: { name: "ORP", label: "Oxidation-reduction potential", unit: "mV", decimals: 0, color: "#f0bd5e", minSpan: 20 },
  temperature: { name: "Temperature", label: "Water temperature", unit: "°C", decimals: 2, color: "#5fd9b8", minSpan: 1 },
} as const;
const metricKeys = Object.keys(metrics) as Metric[];
const rangeLabels: Record<Range, string> = { "15m": "15 minutes", "1h": "hour", "6h": "6 hours", "24h": "24 hours" };
const axisTick = { fill: "#7f979b", fontSize: 11 };

type ChartRow = ReturnType<typeof chartReadings>[number];

function formatValue(value: number | null | undefined, metric: Metric) {
  return value == null ? "—" : value.toFixed(metrics[metric].decimals);
}
function formatChange(change: number | null, metric: Metric) {
  if (change == null) return "—";
  const rounded = Number(change.toFixed(metrics[metric].decimals));
  if (rounded === 0) return "No change";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(metrics[metric].decimals)}`;
}
function clock(time: string | number, seconds = false) {
  return new Date(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) });
}
function ageLabel(time: string, now: number) {
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
function chartTicks(values: number[], metric: Metric) {
  if (!values.length) return [0, 1];
  const low = Math.min(...values); const high = Math.max(...values);
  const span = Math.max((high - low) * 1.5, metrics[metric].minSpan);
  const middle = (low + high) / 2;
  const step = niceStep(span / 3);
  const start = Math.floor((middle - span / 2) / step) * step;
  const end = Math.ceil((middle + span / 2) / step) * step;
  return Array.from({ length: Math.round((end - start) / step) + 1 }, (_, index) => Number((start + index * step).toFixed(4)));
}

export function Dashboard({ publicReadings = false }: { publicReadings?: boolean }) {
  const [range, setRange] = useState<Range>("15m");
  const [snapshot, setSnapshot] = useState<{ range: Range; data: Telemetry } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [now, setNow] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [view, setView] = useState<"live" | "setup">("live");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const data = snapshot?.range === range ? snapshot.data : null;
  const latest = snapshot?.data.latest;
  const live = !error && isRecent(latest?.time, now);
  const readings = data?.readings ?? [];
  const chart = useMemo(() => chartReadings(data?.readings ?? []), [data]);
  const hovered = hoverIndex == null ? null : chart[hoverIndex] ?? null;
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
          <Link className="brand" href="/" aria-label="AquaSense home"><Waves size={20} />AquaSense</Link>
          <nav aria-label="Main navigation"><button className={view === "live" ? "active" : ""} onClick={() => setView("live")}>Live readings</button><button className={view === "setup" ? "active" : ""} onClick={() => setView("setup")}>Station guide</button></nav>
          <span className="station-access">{publicReadings ? "Public station" : "Private station"}</span>
        </div>
      </header>

      <main className="page-wrap">
        {view === "setup" ? <StationGuide /> : <>
          <section className="page-heading">
            <div>
              <h1>Water monitoring</h1>
              <p className="heading-note">Tibet Butler sensor, station 3536852</p>
            </div>
            <div className="connection-state">
              <span role="status" className={`status-pill ${live ? "live" : "waiting"}`}><span className="status-dot" />{status}</span>
              <span>{latest && now ? `Updated ${ageLabel(latest.time, now)}` : "Waiting for a reading"}</span>
            </div>
          </section>

          {error && <div className="notice" role="alert"><Info size={18} /><div>{error} {latest && "Showing the last received values."}{!publicReadings && <a href="/signin-with-chatgpt?return_to=%2F" target="_top">Sign in again</a>}</div></div>}
          {!error && latest && !live && <div className="notice"><Wifi size={18} /><span>No new reading for over a minute. Check the kit’s power and Wi-Fi, or send <code>datalog</code> if calibration paused uploads.</span></div>}

          <section className="monitor" aria-label="Sensor readings and trends">
            <div className="monitor-bar">
              <p>{hovered ? <>Showing values at <strong>{clock(hovered.timestamp, true)}</strong></> : <>Last {rangeLabels[range]}, {readings.length} readings</>}</p>
              <div className="range-picker" role="group" aria-label="Time window">{(Object.keys(ranges) as Range[]).map(key => <button key={key} onClick={() => setRange(key)} aria-pressed={range === key}>{key}</button>)}</div>
            </div>
            {metricKeys.map((key, index) => <MetricRow key={key} metric={key} chart={chart} readings={readings} latest={latest?.[key] ?? null} hovered={hovered} range={range} busy={busy} showTimeAxis={index === metricKeys.length - 1} onHover={setHoverIndex} />)}
            {data?.historyPartial && <p className="history-warning">Some history couldn’t load. Current readings are available.</p>}
          </section>

          <div className="lower-grid">
            <section className="table-panel panel">
              <div className="panel-heading">
                <div><h2>Recent readings</h2><p>Newest first, in your local time.</p></div>
                <button className="secondary-button" onClick={() => downloadCsv(readings)} disabled={!readings.length}><Download size={15} />Export CSV</button>
              </div>
              <div className="table-scroll"><table>
                <thead><tr><th scope="col">Time</th><th scope="col">pH</th><th scope="col">ORP <span>mV</span></th><th scope="col">Temp <span>°C</span></th><th scope="col">Entry</th></tr></thead>
                <tbody>
                  {readings.slice(-8).reverse().map(row => <tr key={row.id}><td>{clock(row.time, true)}</td><td>{formatValue(row.ph, "ph")}</td><td>{formatValue(row.orp, "orp")}</td><td>{formatValue(row.temperature, "temperature")}</td><td className="muted">{row.id}</td></tr>)}
                  {!readings.length && <tr><td colSpan={5} className="empty-row">{busy ? "Loading readings…" : "No readings in this time window."}</td></tr>}
                </tbody>
              </table></div>
            </section>
            <AlertPanel refresh={refresh} />
          </div>
          <div className="data-note"><Info size={14} /><p>Measurements support on-site checks; they do not establish animal safety. Pause alerting before moving, cleaning, or calibrating the probes.</p></div>
        </>}
        <footer className="page-footer"><span>AquaSense with the Atlas Scientific Wi-Fi Pool Kit</span><button onClick={() => setRefresh(value => value + 1)} disabled={busy} className="refresh-button"><RefreshCw size={14} className={busy ? "spinning" : ""} />{busy ? "Updating" : "Refresh now"}</button></footer>
      </main>
    </div>
  );
}

type MetricRowProps = { metric: Metric; chart: ChartRow[]; readings: Reading[]; latest: number | null; hovered: ChartRow | null; range: Range; busy: boolean; showTimeAxis: boolean; onHover: (index: number | null) => void };

function MetricRow({ metric, chart, readings, latest, hovered, range, busy, showTimeAxis, onHover }: MetricRowProps) {
  const config = metrics[metric];
  const values = metricValues(readings, metric);
  const low = values.length ? Math.min(...values) : null;
  const high = values.length ? Math.max(...values) : null;
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const change = values.length > 1 ? values[values.length - 1] - values[0] : null;
  const ticks = chartTicks(values, metric);
  const lastIndex = chart.findLastIndex(row => row[metric] != null);
  const shown = hovered ? hovered[metric] : latest;
  const position = shown == null || low == null || high == null || high === low ? 0.5 : (shown - low) / (high - low);
  const gradientId = `fill-${metric}`;

  return <div className="metric-row" style={{ "--metric": config.color } as React.CSSProperties}>
    <div className="readout">
      <h2><span className="metric-swatch" />{config.name}<span className="readout-label">{config.label}</span></h2>
      <p className="readout-value"><span>{formatValue(shown, metric)}</span>{config.unit && <small>{config.unit}</small>}</p>
      <p className="readout-change">{hovered ? (shown == null || latest == null ? "No reading at this time" : <><strong>{formatChange(latest - shown, metric)}</strong> from here to now</>) :<><strong>{formatChange(change, metric)}</strong> over the last {rangeLabels[range]}</>}</p>
      <div className="range-track" aria-hidden="true"><span style={{ left: `${Math.min(1, Math.max(0, position)) * 100}%` }} /></div>
      <dl className="readout-stats">
        <div><dt>Low</dt><dd>{formatValue(low, metric)}</dd></div>
        <div><dt>Average</dt><dd>{formatValue(average, metric)}</dd></div>
        <div><dt>High</dt><dd>{formatValue(high, metric)}</dd></div>
      </dl>
    </div>
    <div className={`trace ${showTimeAxis ? "with-axis" : ""}`} role="img" aria-label={`${config.name} over the last ${rangeLabels[range]}. Values are also listed in the readings table and CSV export.`}>
      {values.length ? <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chart} syncId="aquasense" margin={{ top: 12, right: 0, left: 0, bottom: showTimeAxis ? 0 : 10 }} onMouseMove={state => onHover(state.activeTooltipIndex == null ? null : Number(state.activeTooltipIndex))} onMouseLeave={() => onHover(null)}>
          <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={config.color} stopOpacity={0.24} /><stop offset="100%" stopColor={config.color} stopOpacity={0.02} /></linearGradient></defs>
          <CartesianGrid stroke="#1a2e36" vertical={false} />
          <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} hide={!showTimeAxis} tickFormatter={value => clock(Number(value))} tick={axisTick} axisLine={false} tickLine={false} minTickGap={80} tickMargin={10} height={showTimeAxis ? 28 : 0} />
          <YAxis orientation="right" domain={[ticks[0], ticks[ticks.length - 1]]} ticks={ticks} tick={axisTick} tickFormatter={value => Number(value).toFixed(config.decimals)} axisLine={false} tickLine={false} width={48} tickMargin={8} />
          {average != null && <ReferenceLine y={average} stroke={config.color} strokeOpacity={0.45} strokeDasharray="2 4" />}
          <Tooltip content={() => null} cursor={{ stroke: "#58737a", strokeWidth: 1 }} isAnimationActive={false} />
          <Area type="monotone" dataKey={metric} stroke={config.color} strokeWidth={1.75} fill={`url(#${gradientId})`} connectNulls={false} isAnimationActive={false}
            dot={({ cx, cy, index }) => index === lastIndex && cx != null && cy != null ? <g key="last"><circle cx={cx} cy={cy} r={7} fill={config.color} opacity={0.2} /><circle cx={cx} cy={cy} r={3.5} fill={config.color} /></g> : <g key={index} />}
            activeDot={{ r: 4, fill: config.color, stroke: "#0b161c", strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer> : <p className="trace-empty">{busy ? "Loading history…" : "No measurements in this window."}</p>}
    </div>
  </div>;
}

function StationGuide() {
  return <div className="setup-view"><section className="page-heading"><div><h1>Station guide</h1><p className="heading-note">Network connection, alert rules, and probe maintenance.</p></div><span className="status-pill live"><Check size={14} />pH and ORP calibrated</span></section>
    <div className="guide-grid"><section className="panel guide-panel"><Wifi className="guide-icon" /><h2>Power and connection</h2><p>The kit connects to its configured Wi-Fi automatically after power-on. It can also renew the specifically approved guest portal session.</p><ul><li>Use the kit’s USB connection with a suitable power adapter.</li><li>Your MacBook is only needed for programming or serial calibration.</li><li>Open this website on your phone or computer to check readings.</li></ul></section>
    <section className="panel guide-panel"><Waves className="guide-icon" /><h2>Changing networks</h2><ol><li>Get the pool’s <strong>2.4 GHz Wi-Fi name</strong> and any required password.</li><li>Connect the kit to your Mac once so we can update its Wi-Fi credentials.</li><li>Verify fresh readings here, then move the USB cable to its power adapter.</li></ol><p className="guide-note">The configured guest portal is supported. Other sign-in pages need inspection first. If the approved disclaimer changes, automatic acceptance pauses.</p></section></div>
    <section className="panel guide-panel"><h2>Know what the status means</h2><div className="status-explainer"><div><span className="status-pill live"><span className="status-dot" />Live</span><p>A reading arrived within the last minute. New measurements are normally uploaded about every 16 seconds.</p></div><div><span className="status-pill waiting"><span className="status-dot" />No recent readings</span><p>The last reading is older than a minute. Check power, Wi-Fi, or whether <code>poll</code> mode paused uploads. The last values stay visible with their age.</p></div></div></section>
    <section className="panel guide-panel"><h2>Rapid-change email alerts</h2><p>The background monitor checks once per minute for a change of at least 0.5 pH units or 2°C within two minutes. A second consecutive reading must confirm the change. The reference is the median of three earlier readings.</p><p>Repeated alerts for the same sensor are suppressed for 15 minutes unless a further change of at least 1.0 pH unit or 4°C occurs. Missing readings, stale data, and gaps in transmission do not generate change alerts. The monitor learns a new baseline after a gap.</p><p>These are operational warning rules, not species-specific lethal limits. Staff should inspect the enclosure and verify unexpected measurements. Ask the operator to disable alerts before probe handling, cleaning, or calibration; the public dashboard cannot change alert settings.</p></section>
    <details className="panel guide-panel"><summary>Calibration and maintenance <ChevronDown size={18} /></summary><div className="details-content"><p>pH was calibrated at 7.00, 4.00, and 10.00. ORP was calibrated in 225 mV reference solution on October 14, 2026. The temperature probe retains its existing calibration.</p><p>For later calibration, connect USB serial at 9600 baud with carriage-return line endings. Use <code>poll</code> to pause uploads and observe readings, then <code>datalog</code> to resume. Only send calibration commands while the correct probe is stable in the matching reference solution.</p><p>Rinse probes between solutions and return them to the appropriate storage solution when finished. This dashboard is read-only and cannot dose chemicals or change calibration.</p></div></details>
  </div>;
}
