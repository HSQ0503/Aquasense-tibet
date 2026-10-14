import test from "node:test";
import assert from "node:assert/strict";
import { numberOrNull, parseFeed, mergeReadings, isRecent, chartReadings } from "./telemetry.ts";

test("missing and invalid measurements stay missing; zero remains a measurement", () => {
  for (const value of [null, undefined, "", " ", "NaN", "Infinity", false, {}]) assert.equal(numberOrNull(value), null);
  assert.equal(numberOrNull("0"), 0);
  assert.equal(numberOrNull("-125.5"), -125.5);
});
test("feed mapping preserves pH, ORP, Celsius and missing temperature", () => {
  assert.deepEqual(parseFeed({ feeds: [{ entry_id: 7, created_at: "2026-10-14T19:00:00Z", field1: "7.2", field2: "225", field3: null }] }),
    [{ id: 7, time: "2026-10-14T19:00:00Z", ph: 7.2, orp: 225, temperature: null }]);
  assert.deepEqual(parseFeed({ feeds: [{ entry_id: 1, created_at: "invalid" }] }), []);
  assert.throws(() => parseFeed(-1));
});
test("fresh feed supersedes cached history and is chronologically ordered", () => {
  const a = { id: 1, time: "2026-10-14T19:00:00Z", ph: 7, orp: 225, temperature: 25 };
  const b = { ...a, id: 2, time: "2026-10-14T19:00:16Z" };
  assert.deepEqual(mergeReadings([b, a], [{ ...b, temperature: null }]), [a, { ...b, temperature: null }]);
});
test("old, missing and future timestamps cannot look live", () => {
  const now = Date.parse("2026-10-14T19:01:00Z");
  assert.equal(isRecent("2026-10-14T19:00:44Z", now), true);
  for (const time of [undefined, "invalid", "2026-10-14T18:59:59Z", "2026-10-14T19:02:00Z"]) assert.equal(isRecent(time, now), false);
});
test("chart breaks across missing upload intervals instead of inventing continuity", () => {
  const a = { id: 1, time: "2026-10-14T19:00:00Z", ph: 7, orp: 225, temperature: 25 };
  const b = { ...a, id: 2, time: "2026-10-14T19:02:00Z" };
  const chart = chartReadings([a, b]);
  assert.equal(chart.length, 3);
  assert.equal(chart[1].ph, null);
  assert.equal(chart[2].ph, 7);
});
