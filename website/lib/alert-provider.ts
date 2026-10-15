import { Resend } from "resend";
import { DeliveryError } from "./alert-runner.ts";
import type { AlertMessage } from "./alert-email";

export function alertProvider() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Email provider is not configured");
  const resend = new Resend(key);
  return {
    async send(messages: AlertMessage[], idempotencyKey: string) {
      for (let attempt = 0; attempt < 3; attempt++) {
        let retryable = true;
        try {
          const result = await resend.batch.send(messages, { idempotencyKey, signal: AbortSignal.timeout(10000) });
          if (result.data?.data.length === messages.length) return result.data.data.map(row => row.id);
          const code = result.error?.statusCode;
          retryable = code == null || code === 429 || code >= 500;
          if (!retryable) throw new DeliveryError(`Email provider rejected the request (${code ?? "unknown"}).`, false);
        } catch (error) {
          if (error instanceof DeliveryError) throw error;
        }
        if (attempt === 2) throw new DeliveryError("Email provider unavailable after three attempts; retry pending.", retryable);
        await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
      }
      throw new DeliveryError("Email could not be sent.", true);
    },
    async receipt(id: string) {
      await new Promise(resolve => setTimeout(resolve, 550));
      const result = await resend.emails.get(id, { signal: AbortSignal.timeout(7000) });
      return result.data?.last_event ?? null;
    },
  };
}
