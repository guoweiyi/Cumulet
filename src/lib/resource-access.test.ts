import { describe, expect, it } from "vitest";
import { isUserManageableResource } from "./resource-access";

describe("resource management access", () => {
  it("keeps access independent of VM power state by using lifecycle state only", () => {
    expect(isUserManageableResource("ACTIVE", "ACTIVE")).toBe(true);
  });

  it.each(["EXPIRED", "SUSPENDED", "PENDING_DELETION", "DELETED"] as const)(
    "denies resource state %s",
    (status) => {
      expect(isUserManageableResource("ACTIVE", status)).toBe(false);
    },
  );

  it("denies a closed ticket even if its resource row is stale-active", () => {
    expect(isUserManageableResource("CLOSED", "ACTIVE")).toBe(false);
  });
});
