import { evaluateReadings, initialEngine, type ChangeAlert, type EngineState, type FeedHealth } from "./alert-engine.ts";
import { alertMessages, type AlertMessage } from "./alert-email.ts";
import type { Reading } from "./telemetry";

export type Delivery = { event: ChangeAlert; messages: AlertMessage[]; status: "queued" | "sent" | "delivered" | "failed"; attempts: number; providerIds: string[]; receiptStatuses: Record<string, string>; queuedAt: string; sentAt: string | null; lastAttemptAt: string | null; error: string | null };
export type MonitorState = { version: 1; engine: EngineState; lease: { id: string; until: number } | null; lastCheckedAt: string | null; lastReadingAt: string | null; health: FeedHealth | "error"; error: string | null; deliveries: Delivery[] };
export type StateStore = { read(): Promise<{ state: MonitorState; etag: string } | null>; write(state: MonitorState, etag: string | null): Promise<string> };
export class ConcurrentUpdate extends Error {}
export class DeliveryError extends Error { retryable: boolean; constructor(message: string, retryable: boolean) { super(message); this.retryable = retryable; } }
export type MonitorIO = { store: StateStore; readFeed(): Promise<Reading[]>; send(messages: AlertMessage[], key: string): Promise<string[]>; receipt(id: string): Promise<string | null>; now(): number };
export function initialMonitor(): MonitorState {
  return { version: 1, engine: initialEngine(), lease: null, lastCheckedAt: null, lastReadingAt: null, health: "learning", error: null, deliveries: [] };
}

export async function runMonitor(io: MonitorIO, recipients: string[]) {
  const stored = await io.store.read();
  let etag = stored?.etag ?? null;
  const state = stored?.state ?? initialMonitor();
  const now = io.now();
  if (state.lease && state.lease.until > now) return { status: "busy" };
  const lease = { id: crypto.randomUUID(), until: now + 120000 };
  state.lease = lease;
  try { etag = await io.store.write(state, etag); }
  catch (error) { if (error instanceof ConcurrentUpdate) return { status: "busy" }; throw error; }
  async function save() {
    if (io.now() >= lease.until) throw new ConcurrentUpdate("Lease expired");
    etag = await io.store.write(state, etag);
  }
  try {
    try {
      const evaluated = evaluateReadings(state.engine, await io.readFeed(), io.now());
      state.engine = evaluated.state; state.health = evaluated.health; state.lastReadingAt = evaluated.latest?.time ?? null; state.error = null;
      for (const event of evaluated.events) {
        state.deliveries.push({ event, messages: alertMessages(event, recipients), status: "queued", attempts: 0,
          providerIds: [], receiptStatuses: {}, queuedAt: new Date(io.now()).toISOString(), sentAt: null, lastAttemptAt: null, error: null });
      }
    } catch {
      state.health = "error"; state.error = "Sensor feed could not be checked. Retrying next minute.";
    }
    state.lastCheckedAt = new Date(io.now()).toISOString();
    // Persist the cursor and immutable outbox before calling the email provider.
    await save();
    for (const delivery of state.deliveries.filter(d => d.status === "queued")) {
      if (io.now() - Date.parse(delivery.queuedAt) > 15 * 60000) {
        delivery.status = "failed"; delivery.error = "Delivery expired after 15 minutes of unsuccessful attempts."; await save(); continue;
      }
      delivery.attempts++; delivery.lastAttemptAt = new Date(io.now()).toISOString(); await save();
      try {
        delivery.providerIds = await io.send(delivery.messages, `aquasense/${delivery.event.id}`);
        delivery.status = "sent"; delivery.sentAt = new Date(io.now()).toISOString(); delivery.error = null;
        for (const id of delivery.providerIds) delivery.receiptStatuses[id] = "sent";
      } catch (error) {
        delivery.error = error instanceof DeliveryError ? error.message : "Email provider unavailable; retry pending.";
        if (error instanceof DeliveryError && !error.retryable) delivery.status = "failed";
      }
      await save();
    }
    let checked = 0;
    for (const delivery of [...state.deliveries].reverse().filter(d => d.status === "sent")) {
      for (const id of delivery.providerIds) {
        if (checked >= 4 || ["delivered", "bounced", "complained", "failed", "suppressed"].includes(delivery.receiptStatuses[id])) continue;
        checked++;
        try { const receipt = await io.receipt(id); if (receipt) delivery.receiptStatuses[id] = receipt; } catch { /* The next cron invocation retries receipt checks. */ }
      }
      const statuses = Object.values(delivery.receiptStatuses);
      if (statuses.some(s => ["bounced", "complained", "failed", "suppressed"].includes(s))) {
        delivery.status = "failed"; delivery.error = "At least one recipient delivery failed. Check Resend delivery records.";
      } else if (statuses.length === delivery.messages.length && statuses.every(s => s === "delivered")) delivery.status = "delivered";
    }
    state.deliveries = [...state.deliveries.filter(d => d.status === "queued"), ...state.deliveries.filter(d => d.status !== "queued").slice(-20)];
    state.lease = null; await save();
    return { status: state.health, processedThrough: state.engine.cursor, pending: state.deliveries.filter(d => d.status === "queued").length };
  } catch (error) {
    // An uncertain store write must not be overwritten with an older state.
    // The bounded lease expires and the durable outbox is retried idempotently.
    if (error instanceof ConcurrentUpdate) return { status: "busy" };
    throw error;
  }
}
