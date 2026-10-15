import { timingSafeEqual } from "node:crypto";

export function isCronAuthorized(header: string | null, secret = process.env.CRON_SECRET): boolean {
  if (!secret || secret.length < 32 || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(header);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
export function alertRecipients(): string[] {
  const value: unknown = JSON.parse(process.env.ALERT_RECIPIENTS || "[]");
  if (!Array.isArray(value) || value.length < 1 || value.length > 10 ||
      !value.every(v => typeof v === "string" && /^[^\s@,<>]+@[^\s@,<>]+\.[a-z]{2,}$/i.test(v))) {
    throw new Error("Alert recipients are not configured");
  }
  return [...new Set(value as string[])];
}
