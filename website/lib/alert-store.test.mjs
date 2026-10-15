import test from 'node:test';
import assert from 'node:assert/strict';
import { alertStore } from './alert-store.ts';
import { initialMonitor } from './alert-runner.ts';

// Opt-in integration test against an isolated private Blob object.
const enabled = process.env.RUN_BLOB_TESTS === 'true';
test('large persisted state keeps a strong ETag and can be updated repeatedly', { skip: !enabled }, async () => {
  const { del } = await import('@vercel/blob');
  const pathname = `aquasense/test-${crypto.randomUUID()}.json`;
  const store = alertStore(pathname);
  const state = initialMonitor();
  state.error = 'Large realistic monitoring state. '.repeat(150);
  try {
    let etag = await store.write(state, null);
    for (let i = 0; i < 3; i++) {
      const read = await store.read();
      assert.equal(read.etag, etag);
      assert.ok(!read.etag.startsWith('W/'));
      read.state.lastCheckedAt = new Date(Date.now() + i).toISOString();
      etag = await store.write(read.state, read.etag);
    }
  } finally {
    await del(pathname, { token: process.env.BLOB_READ_WRITE_TOKEN });
  }
});
