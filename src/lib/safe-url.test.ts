import { describe, expect, it, vi } from "vitest";

vi.mock("undici", () => ({ Agent: class Agent {} }));

import { isPrivateAddress, parseOutboundUrl } from "./safe-url";

describe("outbound URL SSRF protection", () => {
  it.each([
    "127.0.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "192.0.2.1",
    "198.51.100.4",
    "203.0.113.9",
    "::1",
    "::ffff:7f00:1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
  ])("rejects non-public address %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])(
    "permits public address %s",
    (address) => expect(isPrivateAddress(address)).toBe(false),
  );

  it("requires credential-free HTTPS URLs", () => {
    expect(() => parseOutboundUrl("http://example.com/hook")).toThrow("https_required");
    expect(() => parseOutboundUrl("https://user:secret@example.com/hook")).toThrow("invalid_url");
    expect(parseOutboundUrl("https://example.com/hook").href).toBe("https://example.com/hook");
  });
});
