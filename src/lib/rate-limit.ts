import { tooMany } from "./api";
import { isIP } from "node:net";

/**
 * Header stamped by server.js with the TCP peer address. server.js always
 * overwrites the value before Next sees it, so client-supplied XFF can never
 * spoof it (direct deployments otherwise let attackers rotate rate-limit
 * buckets by sending arbitrary X-Forwarded-For headers).
 */
export const REAL_IP_HEADER = "x-cumulet-real-ip";

function normalizeIp(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  // Normalize IPv4-mapped IPv6 (::ffff:127.0.0.1) to plain IPv4.
  if (value.startsWith("::ffff:")) value = value.slice("::ffff:".length);
  return isIP(value) ? value : null;
}

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

/** Prefer the server-stamped peer address; fall back to XFF only when the
 * trusted header is absent (e.g. non-custom-server deployments). */
export function clientIpFromHeaders(reqHeaders: Headers): string {
  const trusted = reqHeaders.get(REAL_IP_HEADER);
  if (trusted) {
    const ip = normalizeIp(trusted);
    if (ip) return ip;
  }
  const fwd = reqHeaders.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0].trim();
    const ip = normalizeIp(first);
    if (ip) return ip;
  }
  return "local";
}

export function clientIp(req: Request): string {
  return clientIpFromHeaders(req.headers);
}
