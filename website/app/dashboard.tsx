"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, ArrowUpRight, Check, ChevronDown, Download, Droplets, Info, Radio, RefreshCw, ShieldCheck, Thermometer, Waves, Wifi, Zap } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartReadings, isRecent, ranges, type Metric, type Range, type Reading, type Telemetry } from "@/lib/telemetry";

const metrics = {
  ph: { name: "pH", label: "Acidity", unit: "pH", decimals: 2, color: "#c1b2f5", icon: Droplets },
  orp: { name: "ORP", label: "Oxidation-reduction potential", unit: "mV", decimals: 0, color: "#efba82", icon: Zap },
  temperature: { name: "Temperature", label: "Water temperature", unit: "°C", decimals: 2, color: "#7fdccd", icon: Thermometer },
} as const;
const metricKeys = Object.keys(metrics) as Metric[];
const rangeLabels: Record<Range, string> = { "15m": "15 min", "1h": "1 hour", "6h": "6 hours", "24h": "24 hours" };

function formatValue(value: number | null | undefined, metric: Metric) {
  return value == null ? "—" : value.toFixed(metrics[metric].decimals);
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
  const values = readings.flatMap(row => row[metric] == null ? [] : [row[metric]]);
  const low = values.length ? Math.min(...values) : null;
  const high = values.length ? Math.max(...values) : null;
  const status = error ? "Connection interrupted" : !latest ? (busy ? "Connecting" : "Waiting for readings") : live ? "Receiving data" : "No recent readings";

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
        <Link className="brand" href="/" aria-label="AquaSense home"><span className="brand-icon"><Waves size={24} /></span>AquaSense<span className="brand-divider" /><span className="brand-note">Water monitoring</span></Link>
        <nav aria-label="Main navigation"><button className={view === "live" ? "active" : ""} onClick={() => setView("live")}>Live readings</button><button className={view === "setup" ? "active" : ""} onClick={() => setView("setup")}>Station guide</button></nav>
        <span className="private-badge"><ShieldCheck size={15} />{publicReadings ? "Public station" : "Private station"}</span>
      </header>

      <main className="page-wrap">
        <div className="station-bar"><span><Radio size={16} />Tibet Butler Sensor</span><span className="station-id">Station 3536852</span></div>
        {view === "setup" ? <StationGuide /> : <>
          <section className="page-heading">
            <div><h1>Your water, in view.</h1><p>pH, ORP, and temperature. Direct from your sensor station.</p></div>
            <div className="connection-state" role="status"><span className={`status-pill ${live ? "live" : "waiting"}`}><span className="status-dot" />{status}</span><span className="muted">Last reading {ageLabel(latest?.time, now)}</span></div>
          </section>

          {error && <div className="notice" role="alert"><Info size={18} /><div>{error} {latest && "Showing the last received values."}{!publicReadings && <a href="/signin-with-chatgpt?return_to=%2F" target="_top">Sign in again</a>}</div></div>}
          {!error && latest && !live && <div className="notice"><Wifi size={18} /><span>No new reading for over a minute. Check the kit’s power and Wi-Fi, or send <code>datalog</code> if calibration paused uploads.</span></div>}
          <section className="measurements" aria-label="Latest sensor readings">
            {metricKeys.map(key => {
              const config = metrics[key]; const Icon = config.icon;
              return <button key={key} className={`measurement ${metric === key ? "selected" : ""}`} style={{ "--metric": config.color } as React.CSSProperties} onClick={() => setMetric(key)} aria-pressed={metric === key} aria-label={`Show ${config.name} trend`}>
                <div className="measurement-top"><span><Icon size={18} />{config.name}</span><ArrowUpRight size={16} className="metric-arrow" /></div>
                <div className="measurement-value">{formatValue(latest?.[key], key)}<span>{config.unit}</span></div>
                <div className="measurement-footer"><span>{latest?.[key] == null ? "No measurement" : config.label}</span><span className="metric-line" /></div>
              </button>;
            })}
          </section>

          <div className="main-grid">
            <section className="chart-panel panel">
              <div className="panel-heading"><div><h2>{selected.name} over time</h2><p>Last {rangeLabels[range]} <span className="separator">/</span> {values.length} measurements</p></div><div className="range-picker" aria-label="Chart time range">{(Object.keys(ranges) as Range[]).map(key => <button key={key} onClick={() => setRange(key)} aria-pressed={range === key}>{key}</button>)}</div></div>
              <div className="chart-stats"><span>Low <strong style={{ color: selected.color }}>{formatValue(low, metric)}</strong></span><span>High <strong style={{ color: selected.color }}>{formatValue(high, metric)}</strong></span><span className="chart-unit">{selected.unit}</span></div>
              <div className="chart-container" role="img" aria-label={`${selected.name} chart for the last ${rangeLabels[range]}. Values are also available in the readings table and CSV export.`}>
                {values.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{ top: 16, right: 16, left: -18, bottom: 5 }}>
                  <CartesianGrid stroke="#25404c" strokeDasharray="3 5" vertical={false} />
                  <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} tickFormatter={value => clock(Number(value))} tick={{ fill: "#9ab2bc", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={60} />
                  <YAxis domain={["auto", "auto"]} tick={{ fill: "#9ab2bc", fontSize: 11 }} tickFormatter={value => Number(value).toFixed(metric === "orp" ? 0 : 1)} axisLine={false} tickLine={false} width={64} />
                  <Tooltip contentStyle={{ background: "#142c38", border: "1px solid #385361", borderRadius: 10, color: "#edf7f4", fontSize: 13 }} labelFormatter={value => clock(Number(value), true)} formatter={value => [value == null ? "Missing" : `${Number(value).toFixed(selected.decimals)} ${selected.unit}`, selected.name]} cursor={{ stroke: "#647d88", strokeDasharray: "4 4" }} />
                  <Line type="linear" dataKey={metric} stroke={selected.color} strokeWidth={2.5} connectNulls={false} dot={values.length === 1 ? { r: 4 } : false} activeDot={{ r: 5 }} isAnimationActive={false} />
                </LineChart></ResponsiveContainer> : <div className="chart-empty"><Activity size={30} /><h3>{busy ? "Loading sensor history" : "No measurements in this window"}</h3><p>{busy ? "Connecting to your station’s feed…" : "Try a longer time range, or check the kit’s power and Wi-Fi."}</p></div>}
              </div>
              <div className="chart-caption"><span><span className="legend-dot" style={{ background: selected.color }} />Measured {selected.name.toLowerCase()}</span><span>Gaps indicate missing readings</span></div>
              {data?.historyPartial && <p className="history-warning">Some history couldn’t load. Current readings are available.</p>}
            </section>

            <aside className="station-panel panel"><div className="station-art" aria-hidden="true"><svg viewBox="0 0 240 100"><ellipse cx="120" cy="63" rx="85" ry="25" /><ellipse cx="120" cy="63" rx="61" ry="18" /><ellipse cx="120" cy="63" rx="35" ry="10" /><path d="M120 15C120 15 105 35 105 43a15 15 0 0 0 30 0c0-8-15-28-15-28Z" /><path d="M120 43v20" /></svg></div><h2>One station.<br />Always in reach.</h2><p>The kit sends readings over Wi-Fi. Your laptop can stay closed.</p><div className="station-facts"><div><span>Feed status</span><strong className={live ? "text-mint" : ""}>{live ? "Active" : "Waiting"}</strong></div><div><span>Upload interval</span><strong>16 seconds</strong></div><div><span>Dashboard refresh</span><strong>Automatic</strong></div><div><span>Data source</span><strong>ThingSpeak</strong></div></div><button className="text-button" onClick={() => setView("setup")}>Taking it to the pool <ArrowUpRight size={16} /></button></aside>
          </div>

          <section className="table-panel panel"><div className="panel-heading"><div><h2>Recent readings</h2><p>Latest entries in this time window. Times shown in your local timezone.</p></div><button className="secondary-button" onClick={() => downloadCsv(readings)} disabled={!readings.length}><Download size={15} />Export CSV</button></div><div className="table-scroll"><table><thead><tr><th scope="col">Recorded at</th><th scope="col">pH</th><th scope="col">ORP <span>mV</span></th><th scope="col">Temperature <span>°C</span></th><th scope="col">Entry</th></tr></thead><tbody>{readings.slice(-6).reverse().map(row => <tr key={row.id}><td>{clock(row.time, true)}</td><td className="ph-cell">{formatValue(row.ph, "ph")}</td><td>{formatValue(row.orp, "orp")}</td><td>{formatValue(row.temperature, "temperature")}</td><td className="muted">#{row.id}</td></tr>)}{!readings.length && <tr><td colSpan={5} className="empty-row">{busy ? "Loading readings…" : "No readings in this time window."}</td></tr>}</tbody></table></div></section>
          <div className="data-note"><Info size={15} /><p>Readings reflect whatever the probes are immersed in, including calibration or storage solution. They do not, on their own, establish whether water is safe to swim in.</p></div>
        </>}
        <footer className="page-footer"><span><span className="footer-mark"><Waves size={15} /></span>AquaSense <span className="footer-separator">/</span> Atlas Scientific Wi-Fi Pool Kit</span><button onClick={() => setRefresh(value => value + 1)} disabled={busy} className="refresh-button"><RefreshCw size={14} className={busy ? "spinning" : ""} />{busy ? "Updating" : "Refresh now"}</button></footer>
      </main>
    </div>
  );
}

function StationGuide() {
  return <div className="setup-view"><section className="page-heading"><div><h1>Take the station with you.</h1><p>A power connection and Wi-Fi are all it needs to keep reporting.</p></div><span className="status-pill live"><Check size={14} />pH and ORP calibrated</span></section>
    <div className="guide-grid"><section className="panel guide-panel"><Wifi className="guide-icon" /><h2>At home, right now</h2><p>The kit connects to its configured Wi-Fi automatically after power-on. It can also renew the specifically approved guest portal session.</p><ul><li>Use the kit’s USB connection with a suitable power adapter.</li><li>Your MacBook is only needed for programming or serial calibration.</li><li>Open this website on your phone or computer to check readings.</li></ul></section>
    <section className="panel guide-panel"><Waves className="guide-icon" /><h2>When you reach the pool</h2><ol><li>Get the pool’s <strong>2.4 GHz Wi-Fi name</strong> and any required password.</li><li>Connect the kit to your Mac once so we can update its Wi-Fi credentials.</li><li>Verify fresh readings here, then move the USB cable to its power adapter.</li></ol><p className="guide-note">The configured guest portal is supported. Other sign-in pages need inspection first. If the approved disclaimer changes, automatic acceptance pauses.</p></section></div>
    <section className="panel guide-panel"><h2>Know what the status means</h2><div className="status-explainer"><div><span className="status-pill live"><span className="status-dot" />Receiving data</span><p>A reading arrived within the last minute. New measurements are normally uploaded about every 16 seconds.</p></div><div><span className="status-pill waiting"><span className="status-dot" />No recent readings</span><p>The last reading is older than a minute. Check power, Wi-Fi, or whether <code>poll</code> mode paused uploads. The last values stay visible with their age.</p></div></div></section>
    <details className="panel guide-panel"><summary>Calibration and maintenance <ChevronDown size={18} /></summary><div className="details-content"><p>pH was calibrated at 7.00, 4.00, and 10.00. ORP was calibrated in 225 mV reference solution on October 14, 2026. The temperature probe retains its existing calibration.</p><p>For later calibration, connect USB serial at 9600 baud with carriage-return line endings. Use <code>poll</code> to pause uploads and observe readings, then <code>datalog</code> to resume. Only send calibration commands while the correct probe is stable in the matching reference solution.</p><p>Rinse probes between solutions and return them to the appropriate storage solution when finished. This dashboard is read-only and cannot dose chemicals or change calibration.</p></div></details>
  </div>;
}
