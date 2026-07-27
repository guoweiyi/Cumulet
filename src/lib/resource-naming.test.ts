import { describe, expect, it } from "vitest";
import { buildResourceName } from "./resource-naming";

describe("buildResourceName", () => {
  it("uses requester and user-defined name", () => {
    expect(buildResourceName({ email: "alice@example.com" }, "database", 101)).toBe("alice_database");
  });

  it("sanitizes unsafe characters and caps PVE names", () => {
    const result = buildResourceName({ email: "alice@example.com", nickname: "Alice Zhang" }, "prod 数据库 ".repeat(20), 101);
    expect(result).toMatch(/^Alice-Zhang_prod-/);
    expect(result.length).toBeLessThanOrEqual(63);
  });
});
