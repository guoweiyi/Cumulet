import { describe, expect, it } from "vitest";
import { clientIp, clientIpFromHeaders, rateLimit, LIMITS, REAL_IP_HEADER } from "./rate-limit";

function headers(init: Record<string, string> = {}): Headers {
  return new Headers(init);
}

describe("clientIp", () => {
  it("prefers the trusted server-stamped header over spoofable XFF", () => {
    const reqHeaders = headers({
      [REAL_IP_HEADER]: "203.0.113.9",
      "x-forwarded-for": "6.6.6.6",
    });
    expect(clientIpFromHeaders(reqHeaders)).toBe("203.0.113.9");
  });

  it("normalizes IPv4-mapped IPv6 addresses", () => {
    expect(clientIpFromHeaders(headers({ [REAL_IP_HEADER]: "::ffff:127.0.0.1" }))).toBe("127.0.0.1");
  });

  it("falls back to the first XFF hop when the trusted header is absent", () => {
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" }))).toBe("198.51.100.7");
  });

  it("rejects malformed values and returns the local fallback", () => {
    expect(clientIpFromHeaders(headers({ [REAL_IP_HEADER]: "not-an-ip" }))).toBe("local");
    expect(clientIp({ headers: headers() } as unknown as Request)).toBe("local");
  });
});

describe("rateLimit", () => {
  it("allows up to the limit and rejects the next request in the window", () => {
    const bucket = `test-${Date.now()}`;
    const subject = "1.2.3.4";
    for (let i = 0; i < LIMITS.adminLogin.max; i += 1) {
      expect(() => rateLimit(bucket, subject, LIMITS.adminLogin.max, 60_000)).not.toThrow();
    }
    expect(() => rateLimit(bucket, subject, LIMITS.adminLogin.max, 60_000)).toThrow(/rate_limited/);
  });

  it("tracks subjects independently", () => {
    const bucket = `test-indep-${Date.now()}`;
    expect(() => rateLimit(bucket, "5.5.5.5", 1, 60_000)).not.toThrow();
    expect(() => rateLimit(bucket, "5.5.5.6", 1, 60_000)).not.toThrow();
    expect(() => rateLimit(bucket, "5.5.5.5", 1, 60_000)).toThrow(/rate_limited/);
  });
});
