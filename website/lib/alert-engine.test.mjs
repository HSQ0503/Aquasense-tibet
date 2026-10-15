import test from "node:test";
import assert from "node:assert/strict";
import { initialEngine, evaluateReadings } from "./alert-engine.ts";

const start = Date.parse("2026-10-15T17:00:00Z");
const row = (i, ph = 7, temperature = 25) => ({ id: i + 1, time: new Date(start + i * 16000).toISOString(), ph, temperature, orp: 225 });
const baseline = Array.from({ length: 5 }, (_, i) => row(i));
const seeded = () => evaluateReadings(initialEngine(), baseline, start + 64000).state;
const evaluate = (rows, state = seeded()) => evaluateReadings(state, rows, Date.parse(rows.at(-1).time));

test("activation learns a baseline without replaying historical emergencies", () => {
  const result = evaluateReadings(initialEngine(), [...baseline, row(5, 9), row(6, 9)], start + 96000);
  assert.equal(result.events.length, 0); assert.equal(result.state.cursor, 7);
});
test("confirmed pH and temperature changes produce independent alerts", () => {
  const result = evaluate([...baseline, row(5, 7.5, 27), row(6, 7.5, 27)]);
  assert.deepEqual(result.events.map(e => e.metric), ["ph", "temperature"]);
  assert.equal(result.events[0].delta, .5); assert.equal(result.events[1].delta, 2);
});
test("a single spike or a return to baseline is not a confirmed change", () => {
  assert.equal(evaluate([...baseline, row(5, 9)]).events.length, 0);
  assert.equal(evaluate([...baseline, row(5, 9), row(6, 7)]).events.length, 0);
});
test("confirmation persists across cron invocations", () => {
  const first = evaluate([...baseline, row(5, 6.4)]);
  const second = evaluate([...baseline, row(5, 6.4), row(6, 6.4)], first.state);
  assert.equal(second.events.length, 1); assert.ok(second.events[0].delta < 0);
});
test("null measurements and reconnect gaps do not become sudden changes", () => {
  assert.equal(evaluate([...baseline, row(5, null, null), row(6, 9, 30), row(7, 9, 30)]).events.length, 0);
  assert.equal(evaluate([...baseline, row(30, 9, 30), row(31, 9, 30)]).events.length, 0);
});
test("stale data and future timestamps cannot trigger an emergency", () => {
  const rows = [...baseline, row(5, 9), row(6, 9)];
  const stale = evaluateReadings(seeded(), rows, start + 300000);
  assert.equal(stale.events.length, 0); assert.equal(stale.health, "stale");
  assert.equal(evaluateReadings(seeded(), rows, start + 64000).events.length, 0);
});
test("repeated invocations and sustained plateaus do not duplicate alerts", () => {
  const rows = [...baseline, row(5, 7.6), row(6, 7.6)];
  const first = evaluate(rows); assert.equal(first.events.length, 1);
  assert.equal(evaluate(rows, first.state).events.length, 0);
  const more = [...rows, ...Array.from({ length: 8 }, (_, i) => row(i + 7, 7.6))];
  assert.equal(evaluate(more, first.state).events.length, 0);
});
test("a further substantial change bypasses the duplicate cooldown", () => {
  const rows = [...baseline, row(5, 7.6), row(6, 7.6)];
  const first = evaluate(rows);
  const next = evaluate([...rows, row(7, 8.7), row(8, 8.7)], first.state);
  assert.equal(next.events.length, 1);
});
test("slow drift below the two-minute change rule is not an alert", () => {
  let state = seeded(); let count = 0;
  for (let i = 5; i < 30; i++) {
    const result = evaluate([row(i, 7 + (i - 4) * .03)], state);
    state = result.state; count += result.events.length;
  }
  assert.equal(count, 0);
});
test("median reference resists one noisy baseline reading", () => {
  const samples = [row(0, 6), row(1), row(2), row(3), row(4)];
  const state = evaluateReadings(initialEngine(), samples, start + 64000).state;
  assert.equal(evaluate([...samples, row(5), row(6)], state).events.length, 0);
});
