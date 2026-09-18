import "server-only";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Agent } from "undici";

// Webhooks are allowed to reach globally routable addresses only. In addition
// to RFC 1918 space, deny loopback, link-local, carrier NAT, documentation,
// benchmarking, multicast, and otherwise reserved ranges. This avoids SSRF
// bypasses through less familiar IP spellings/ranges (especially IPv6).
const NON_PUBLIC_V4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) NON_PUBLIC_V4.addSubnet(network, prefix, "ipv4");
const NON_PUBLIC_V6 = new BlockList();
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96],
  ["64:ff9b:1::", 48], ["100::", 64], ["2001:2::", 48],
  ["2001:10::", 28], ["2001:db8::", 32], ["fc00::", 7],
  ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) NON_PUBLIC_V6.addSubnet(network, prefix, "ipv6");

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return NON_PUBLIC_V4.check(address, "ipv4");
  if (family === 6) return NON_PUBLIC_V6.check(address, "ipv6");
  // A resolver result should always be an IP. Fail closed if a custom resolver
  // or future runtime ever violates that contract.
  return true;
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
