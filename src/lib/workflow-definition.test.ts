import { describe, expect, it } from "vitest";
import { blankWorkflowDefinition, parseWorkflowDefinition, validateApprovalInputs } from "./workflow-definition";

describe("workflow definitions", () => {
  it("adds database approval variables to legacy definitions", () => {
    const definition = parseWorkflowDefinition({
      formatVersion: 1,
      meta: { name: { zh: "数据库" }, resourceType: "database" },
      steps: ["VALIDATE_VMID", "NOTIFY"],
      detailModules: ["summary"],
    });
    expect(definition?.approvalFields.map((field) => field.key)).toContain("databaseAdminPassword");
    expect(definition?.stepConfigs.NOTIFY?.failurePolicy).toBe("SKIP");
  });

  it("validates required and selected approval values", () => {
    const definition = blankWorkflowDefinition({ zh: "数据库" }, "database");
    expect(validateApprovalInputs(definition, {})).toEqual({ ok: false });
    expect(validateApprovalInputs(definition, {
      databaseEngine: "postgresql",
      databaseName: "app",
      databaseAdminUser: "app_admin",
      databaseAdminPassword: "secret-value",
      databasePort: 5432,
    }).ok).toBe(true);
    expect(validateApprovalInputs(definition, {
      databaseEngine: "oracle",
      databaseName: "app",
      databaseAdminUser: "app_admin",
      databaseAdminPassword: "secret-value",
      databasePort: 1521,
    })).toEqual({ ok: false });
  });

  it("accepts templated HTTP request chains and rejects hard-coded auth secrets", () => {
    const definition = blankWorkflowDefinition({ zh: "API 流水线" }, "vm");
    definition.stepConfigs.VALIDATE_VMID!.requests = [{
      id: "create_resource",
      name: { zh: "创建资源" },
      timing: "AFTER",
      method: "POST",
      urlTemplate: "https://api.example.com/resources/{{url:system.vmid}}",
      headers: [{ name: "Authorization", valueTemplate: "Bearer {{approval.apiToken}}" }],
      bodyTemplate: '{"name":{{json:request.resource_name}}}',
      expectedStatuses: "200-201,204",
      captureVariable: "createdResource",
    }];
    expect(parseWorkflowDefinition(definition)).not.toBeNull();
    definition.stepConfigs.VALIDATE_VMID!.requests[0].headers[0].valueTemplate = "Bearer hard-coded-secret";
    expect(parseWorkflowDefinition(definition)).toBeNull();
  });
});
