import { get, put, BlobPreconditionFailedError } from "@vercel/blob";
import { ConcurrentUpdate, type MonitorState, type StateStore } from "./alert-runner.ts";

export function alertStore(pathname = "aquasense/monitor-v1.json"): StateStore {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("Alert storage is not configured");
  return {
    async read() {
      const result = await get(pathname, { access: "private", useCache: false, token, abortSignal: AbortSignal.timeout(10000) });
      if (!result) return null;
      if (result.statusCode !== 200) throw new Error("Unexpected storage response");
      const state = await new Response(result.stream).json() as MonitorState;
      if (state.version !== 1 || !state.engine || !Array.isArray(state.deliveries)) throw new Error("Invalid monitoring state");
      return { state, etag: result.blob.etag };
    },
    async write(state, etag) {
      try {
        const result = await put(pathname, JSON.stringify(state), { access: "private", addRandomSuffix: false, token,
          contentType: "application/json", ...(etag ? { ifMatch: etag } : { allowOverwrite: false }), abortSignal: AbortSignal.timeout(10000) });
        return result.etag;
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError || (error instanceof Error && /already exists/i.test(error.message))) throw new ConcurrentUpdate("State changed");
        throw error;
      }
    },
  };
}
