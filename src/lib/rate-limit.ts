import { tooMany } from "./api";

/**
 * In-process sliding-window rate limiter (monolith deployment; no Redis by
 * design). Keys are `${bucket}:${subject}` where subject is a user id or IP.
 */
const windows = new Map<string, number[]>();

let lastSweep = Date.now();
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, hits] of windows) {
    if (hits.length === 0 || hits[hits.length - 1] < now - 3_600_000) windows.delete(k);
  }
}

export function rateLimit(bucket: string, subject: string, max: number, windowMs: number): void {
  const now = Date.now();
  sweep(now);
  const k = `${bucket}:${subject}`;
  const hits = (windows.get(k) ?? []).filter((t) => t > now - windowMs);
  if (hits.length >= max) throw tooMany();
  hits.push(now);
  windows.set(k, hits);
}

/** Buckets used across the app — single source of limit policy. */
export const LIMITS = {
  adminLogin: { max: 10, windowMs: 15 * 60_000 }, // per IP
  passkey: { max: 20, windowMs: 15 * 60_000 }, // per IP
  power: { max: 15, windowMs: 5 * 60_000 }, // per user
  console: { max: 10, windowMs: 5 * 60_000 }, // per user (vnc tickets)
  firewall: { max: 30, windowMs: 5 * 60_000 }, // per user
  passwordReset: { max: 3, windowMs: 60 * 60_000 }, // per user
  email: { max: 60, windowMs: 60 * 60_000 }, // global outbound guard
  credentialView: { max: 10, windowMs: 15 * 60_000 }, // per IP
  ticketMessage: { max: 30, windowMs: 5 * 60_000 }, // per user
  ticketCreate: { max: 10, windowMs: 60 * 60_000 }, // per user
  aiInspection: { max: 3, windowMs: 60 * 60_000 }, // per user / model cost guard
} as const;

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : "local";
}
