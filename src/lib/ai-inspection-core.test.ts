import { describe, expect, it } from "vitest";
import { parseProvisioningDiagnosis } from "./ai-inspection-core";

describe("parseProvisioningDiagnosis", () => {
  it("accepts a bounded structured diagnosis", () => {
    const parsed = parseProvisioningDiagnosis(JSON.stringify({
      likelyCause: "The provider token lacks VM.Audit.",
      confidence: "high",
      checks: ["Verify the ACL on /vms/101."],
      recoveryActions: ["Grant VM.Audit and retry validation."],
      safeToRetry: true,
    }));
    expect(parsed.safeToRetry).toBe(true);
  });

  it("rejects an unstructured response", () => {
    expect(() => parseProvisioningDiagnosis("retry it")).toThrow();
  });
});
