export type AlertStatus = {
  status: "active" | "warming_up" | "paused" | "needs_attention" | "waiting" | "unavailable";
  message: string;
  checkedAt: string | null;
  readingAt: string | null;
  recipientCount: number;
  lastAlertAt: string | null;
  lastDelivery: string | null;
  pending: number;
  rules: { ph: number; temperature: number; windowSeconds: number; confirmations: number; cooldownMinutes: number };
};
