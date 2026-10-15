import type { Reading } from "./telemetry";

export const alertRules = { ph: 0.5, temperature: 2, windowMs: 120000, maxGapMs: 45000, freshnessMs: 90000, cooldownMs: 900000 } as const;
export type AlertMetric = "ph" | "temperature";
export type Sample = { id: number; time: string; value: number };
export type ChangeAlert = { id: string; metric: AlertMetric; baseline: Sample; first: Sample; confirmed: Sample; delta: number; threshold: number };
type Candidate = { baseline: Sample; first: Sample; direction: number };
type MetricState = { samples: Sample[]; candidate: Candidate | null; lastAlert: Sample | null };
export type EngineState = { cursor: number | null; lastProcessedAt: string | null; metrics: Record<AlertMetric, MetricState> };
export type FeedHealth = "learning" | "healthy" | "partial" | "stale" | "no_data";

export function initialEngine(): EngineState {
  return { cursor: null, lastProcessedAt: null, metrics: { ph: { samples: [], candidate: null, lastAlert: null }, temperature: { samples: [], candidate: null, lastAlert: null } } };
}
function resetSamples(state: EngineState) {
  for (const metric of ["ph", "temperature"] as const) { state.metrics[metric].samples = []; state.metrics[metric].candidate = null; }
}
function sampleFor(row: Reading, metric: AlertMetric): Sample | null {
  const value = row[metric];
  return value !== null && Number.isFinite(value) ? { id: row.id, time: row.time, value } : null;
}
function retain(metric: MetricState, sample: Sample) {
  const time = Date.parse(sample.time);
  const previous = metric.samples.at(-1);
  if (previous && time - Date.parse(previous.time) > alertRules.maxGapMs) { metric.samples = []; metric.candidate = null; }
  metric.samples = metric.samples.filter(s => time - Date.parse(s.time) <= alertRules.windowMs);
}
function baseline(samples: Sample[]): Sample | null {
  if (samples.length < 3) return null;
  const first = samples.slice(0, 3);
  if (Date.parse(first[2].time) - Date.parse(first[0].time) < 20000) return null;
  const median = first.map(s => s.value).sort((a, b) => a - b)[1];
  return { ...first[1], value: median };
}

export function evaluateReadings(previous: EngineState, input: Reading[], now: number) {
  const state = structuredClone(previous);
  const rows = [...new Map(input.map(row => [row.id, row])).values()]
    .filter(row => Number.isFinite(Date.parse(row.time)) && Date.parse(row.time) <= now + 5000)
    .sort((a, b) => a.id - b.id);
  const latest = rows.at(-1) ?? null;
  const events: ChangeAlert[] = [];
  if (!latest) { resetSamples(state); return { state, events, health: "no_data" as FeedHealth, latest: null }; }
  if (now - Date.parse(latest.time) > alertRules.freshnessMs) {
    resetSamples(state); state.cursor = Math.max(state.cursor ?? 0, latest.id); state.lastProcessedAt = latest.time;
    return { state, events, health: "stale" as FeedHealth, latest };
  }
  const initializing = state.cursor === null;
  for (const row of rows) {
    if (state.cursor !== null && row.id <= state.cursor) continue;
    state.cursor = row.id;
    const time = Date.parse(row.time);
    if (state.lastProcessedAt && time <= Date.parse(state.lastProcessedAt)) continue;
    state.lastProcessedAt = row.time;
    if (now - time > alertRules.freshnessMs && !initializing) { resetSamples(state); continue; }
    if (now - time > alertRules.windowMs && initializing) continue;
    for (const metric of ["ph", "temperature"] as const) {
      const track = state.metrics[metric];
      const sample = sampleFor(row, metric);
      if (!sample) { track.samples = []; track.candidate = null; continue; }
      retain(track, sample);
      if (!initializing) {
        const candidate = track.candidate;
        const delta = candidate ? sample.value - candidate.baseline.value : 0;
        const confirmed = candidate && sample.id !== candidate.first.id &&
          time - Date.parse(candidate.first.time) <= alertRules.maxGapMs &&
          time - Date.parse(candidate.baseline.time) <= alertRules.windowMs &&
          Math.sign(delta) === candidate.direction && Math.abs(delta) + 1e-9 >= alertRules[metric];
        if (confirmed) {
          const last = track.lastAlert;
          const coolingDown = last && time - Date.parse(last.time) < alertRules.cooldownMs;
          const escalated = last && Math.abs(sample.value - last.value) + 1e-9 >= alertRules[metric] * 2;
          if (!coolingDown || escalated) {
            events.push({ id: `change-v1-${metric}-${candidate.first.id}-${sample.id}-${time}`, metric,
              baseline: candidate.baseline, first: candidate.first, confirmed: sample,
              delta, threshold: alertRules[metric] });
            track.lastAlert = sample;
          }
          track.candidate = null;
        } else {
          const reference = baseline(track.samples);
          track.candidate = reference && Math.abs(sample.value - reference.value) + 1e-9 >= alertRules[metric]
            ? { baseline: reference, first: sample, direction: Math.sign(sample.value - reference.value) } : null;
        }
      }
      track.samples.push(sample);
    }
  }
  const health: FeedHealth = latest.ph === null || latest.temperature === null ? "partial" :
    Object.values(state.metrics).some(m => m.samples.length < 3) ? "learning" : "healthy";
  return { state, events, health, latest };
}
