export type Reading = {
  id: number;
  time: string;
  ph: number | null;
  orp: number | null;
  temperature: number | null;
};

export type Telemetry = {
  latest: Reading | null;
  readings: Reading[];
  fetchedAt: string;
  historyPartial: boolean;
};

export const ranges = { "15m": 15, "1h": 60, "6h": 360, "24h": 1440 } as const;
export type Range = keyof typeof ranges;
export type Metric = "ph" | "orp" | "temperature";

export function numberOrNull(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseFeed(payload: unknown): Reading[] {
  if (!payload || typeof payload !== "object" || !("feeds" in payload) || !Array.isArray(payload.feeds)) {
    throw new Error("Invalid sensor feed");
  }
  return payload.feeds.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))) return [];
    if (typeof row.entry_id !== "number" || !Number.isSafeInteger(row.entry_id) || row.entry_id < 1) return [];
    return [{ id: row.entry_id, time: row.created_at, ph: numberOrNull(row.field1),
      orp: numberOrNull(row.field2), temperature: numberOrNull(row.field3) }];
  });
}

export function mergeReadings(history: Reading[], recent: Reading[]): Reading[] {
  const entries = new Map<number, Reading>();
  for (const reading of [...history, ...recent]) entries.set(reading.id, reading);
  return [...entries.values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time) || a.id - b.id);
}

export function isRecent(time: string | undefined, now: number): boolean {
  if (!time) return false;
  const age = now - Date.parse(time);
  return Number.isFinite(age) && age >= -5000 && age <= 60000;
}

export function chartReadings(readings: Reading[]) {
  return readings.flatMap((row, index) => {
    const time = Date.parse(row.time);
    const point = { ...row, timestamp: time };
    const previous = readings[index - 1];
    if (previous && time - Date.parse(previous.time) > 60000) {
      return [{ ...point, timestamp: time - 1, ph: null, orp: null, temperature: null }, point];
    }
    return [point];
  });
}
