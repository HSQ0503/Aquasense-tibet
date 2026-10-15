import test from "node:test";
import assert from "node:assert/strict";
import { runMonitor, ConcurrentUpdate, DeliveryError } from "./alert-runner.ts";
import { isCronAuthorized } from "./alert-config.ts";

const start = Date.parse("2026-10-15T17:00:00Z");
const row = (i, ph = 7) => ({ id: i + 1, time: new Date(start + i * 16000).toISOString(), ph, temperature: 25, orp: 225 });
function harness() {
  let version = 0; let saved = null; let now = start + 64000;
  let rows = Array.from({ length: 5 }, (_, i) => row(i));
  const sent = [];
  const io = {
    store: {
      async read() { return saved ? { state: structuredClone(saved), etag: String(version) } : null; },
      async write(state, etag) {
        if (etag !== (saved ? String(version) : null)) throw new ConcurrentUpdate("Conflict");
        saved = structuredClone(state); return String(++version);
      },
    },
    async readFeed() { return rows; },
    async send(messages, key) {
      assert.equal(saved.deliveries.at(-1).status, "queued");
      assert.equal(saved.engine.cursor, 7);
      sent.push({ messages, key }); return messages.map((_, i) => `email-${i}`);
    },
    async receipt() { return "delivered"; },
    now: () => now,
  };
  return { io, sent, saved: () => saved, change() { rows = [...rows, row(5, 8), row(6, 8)]; now = start + 96000; }, advance() { now += 60000; } };
}
const recipients = ["delivered@resend.dev"];

test("outbox is durable before sending and subsequent checks do not resend", async () => {
  const h = harness(); await runMonitor(h.io, recipients); assert.equal(h.sent.length, 0);
  h.change(); await runMonitor(h.io, recipients); assert.equal(h.sent.length, 1);
  assert.equal(h.saved().deliveries[0].status, "delivered");
  await runMonitor(h.io, recipients); assert.equal(h.sent.length, 1);
});
test("an uncertain provider result retries the exact same payload and key", async () => {
  const h = harness(); await runMonitor(h.io, recipients); h.change();
  let original; let calls = 0;
  h.io.send = async (messages, key) => {
    calls++;
    if (calls === 1) { original = { messages: structuredClone(messages), key }; throw new DeliveryError("Retry", true); }
    assert.deepEqual({ messages, key }, original); return ["email-1"];
  };
  await runMonitor(h.io, recipients); assert.equal(h.saved().deliveries[0].status, "queued");
  h.advance(); await runMonitor(h.io, recipients); assert.equal(calls, 2); assert.equal(h.saved().deliveries[0].status, "delivered");
});
test("overlapping workers cannot both acquire the monitoring state", async () => {
  const h = harness();
  const results = await Promise.all([runMonitor(h.io, recipients), runMonitor(h.io, recipients)]);
  assert.equal(results.filter(r => r.status === "busy").length, 1);
});
test("permanent provider errors are recorded without repeated sends", async () => {
  const h = harness(); await runMonitor(h.io, recipients); h.change(); let calls = 0;
  h.io.send = async () => { calls++; throw new DeliveryError("Rejected", false); };
  await runMonitor(h.io, recipients); await runMonitor(h.io, recipients);
  assert.equal(calls, 1); assert.equal(h.saved().deliveries[0].status, "failed");
});
test("the cron route requires a long exact bearer secret", () => {
  const secret = "a".repeat(48);
  assert.equal(isCronAuthorized(null, secret), false);
  assert.equal(isCronAuthorized(`Bearer ${secret}`, undefined), false);
  assert.equal(isCronAuthorized("Bearer wrong", secret), false);
  assert.equal(isCronAuthorized(`Bearer ${secret}`, secret), true);
});
