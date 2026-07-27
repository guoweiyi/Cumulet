import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent } from "undici";

const IPV4_PRIVATE = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^192\.0\.0\./,
  /^198\.1[89]\./,
  /^224\./,
  /^2(?:2[5-9]|3\d|4\d|5[0-5])\./,
];

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) return IPV4_PRIVATE.some((pattern) => pattern.test(address));
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  return false;
}

export function parseOutboundUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("https_required");
  if (url.username || url.password || url.hash) throw new Error("invalid_url");
  if (!url.hostname || ["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())) {
    throw new Error("private_address_forbidden");
  }
  return url;
}

/** Resolve, validate, and pin an outbound host for the lifetime of one Agent. */
export async function safeDispatcher(raw: string): Promise<{ url: URL; dispatcher: Agent }> {
  const url = parseOutboundUrl(raw);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length) throw new Error("host_not_found");
  const allowPrivate = process.env.ALLOW_PRIVATE_OUTBOUND_WEBHOOKS === "true";
  if (!allowPrivate && addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("private_address_forbidden");
  }
  const pinned = addresses[0];
  const dispatcher = new Agent({
    connect: {
      lookup: (_hostname, _options, callback) => {
        callback(null, pinned.address, pinned.family);
      },
    },
  });
  return { url, dispatcher };
}

