import { z } from "zod";
import type { ProvisioningStepType } from "@prisma/client";
import type { I18nText } from "@/i18n/config";

export const WORKFLOW_STEPS: ProvisioningStepType[] = [
  "VALIDATE_VMID", "CLOUD_INIT", "DATABASE_BOOTSTRAP", "PVE_SECURITY_GROUP", "EXTERNAL_ACCESS",
  "JS_ASSET", "JS_PERMISSION", "NOTIFY",
];

export const DETAIL_MODULES = ["summary", "connection", "configuration", "ai", "monitoring", "logs", "console"] as const;
export const APPROVAL_FIELD_TYPES = ["text", "password", "number", "boolean", "select"] as const;
export type DetailModule = (typeof DETAIL_MODULES)[number];
export type ApprovalFieldType = (typeof APPROVAL_FIELD_TYPES)[number];

export type ApprovalOption = { value: string; label: I18nText };
export type ApprovalField = {
  key: string;
  label: I18nText;
  description?: I18nText;
  type: ApprovalFieldType;
  required: boolean;
  sensitive: boolean;
  exposeToOwner: boolean;
  defaultValue?: string | number | boolean;
  options?: ApprovalOption[];
};

export type StepConfig = {
  name?: I18nText;
  description?: I18nText;
  timeoutSeconds: number;
  failurePolicy: "STOP" | "SKIP";
  runBuiltIn: boolean;
  inputBindings: Record<string, string>;
  requests: HttpRequestConfig[];
};

export type HttpRequestConfig = {
  id: string;
  name: I18nText;
  timing: "BEFORE" | "AFTER";
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  urlTemplate: string;
  headers: { name: string; valueTemplate: string }[];
  bodyTemplate?: string;
  expectedStatuses: string;
  captureVariable?: string;
};

export type WorkflowDefinition = {
  formatVersion: 1;
  meta: { name: I18nText; resourceType: string };
  approvalFields: ApprovalField[];
  steps: ProvisioningStepType[];
  stepConfigs: Partial<Record<ProvisioningStepType, StepConfig>>;
  detailModules: DetailModule[];
};

export const STEP_INPUT_SPECS: Record<ProvisioningStepType, { key: string; defaultBinding: string }[]> = {
  VALIDATE_VMID: [{ key: "providerResourceId", defaultBinding: "system.vmid" }],
  CLOUD_INIT: [
    { key: "username", defaultBinding: "system.ciUser" },
    { key: "password", defaultBinding: "system.initialPassword" },
    { key: "sshKeys", defaultBinding: "system.sshKeys" },
    { key: "ipConfig", defaultBinding: "system.ipconfig" },
    { key: "nameserver", defaultBinding: "system.nameserver" },
  ],
  DATABASE_BOOTSTRAP: [
    { key: "engine", defaultBinding: "approval.databaseEngine" },
    { key: "databaseName", defaultBinding: "approval.databaseName" },
    { key: "adminUser", defaultBinding: "approval.databaseAdminUser" },
    { key: "adminPassword", defaultBinding: "approval.databaseAdminPassword" },
    { key: "port", defaultBinding: "approval.databasePort" },
  ],
  PVE_SECURITY_GROUP: [
    { key: "enabled", defaultBinding: "system.configureSecurityGroup" },
    { key: "groupName", defaultBinding: "system.securityGroup" },
  ],
  EXTERNAL_ACCESS: [{ key: "request", defaultBinding: "system.externalAccess" }],
  JS_ASSET: [
    { key: "name", defaultBinding: "system.resourceName" },
    { key: "address", defaultBinding: "system.internalIp" },
  ],
  JS_PERMISSION: [{ key: "accountUsername", defaultBinding: "system.ciUser" }],
  NOTIFY: [{ key: "recipient", defaultBinding: "system.ownerEmail" }],
};

const STEP_DESCRIPTIONS: Record<ProvisioningStepType, I18nText> = {
  VALIDATE_VMID: { zh: "确认目标资源存在并读取当前容量。", en: "Verify the target resource and read its current capacity." },
  CLOUD_INIT: { zh: "写入系统账号、密码、网络和 SSH 公钥，然后重启实例。", en: "Apply the OS account, password, network, and SSH keys, then restart the instance." },
  DATABASE_BOOTSTRAP: { zh: "等待 Guest Agent 恢复，并在已安装的数据库服务中创建库、账号和授权。", en: "Wait for Guest Agent, then create the database, account, and grants in the installed database service." },
  PVE_SECURITY_GROUP: { zh: "创建或复用 PVE 安全组，挂载到虚拟机并启用防火墙。", en: "Create or reuse a PVE security group, attach it to the VM, and enable its firewall." },
  EXTERNAL_ACCESS: { zh: "根据审批内容配置反向代理和分流 DNS。", en: "Configure reverse proxy and split DNS from the approved request." },
  JS_ASSET: { zh: "在用户对应的 JumpServer 节点中创建或更新资产。", en: "Create or update the asset in the user's JumpServer node." },
  JS_PERMISSION: { zh: "创建 JumpServer 用户并授予该资产的连接权限。", en: "Create the JumpServer user if needed and grant access to the asset." },
  NOTIFY: { zh: "发送开通完成通知和资源访问入口。", en: "Send the provisioning result and resource access entry." },
};

const i18nSchema = z.object({ zh: z.string().trim().min(1).max(200), en: z.string().trim().max(200).optional() });
const optionSchema = z.object({ value: z.string().trim().min(1).max(100), label: i18nSchema });
const approvalFieldSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-zA-Z0-9_]{0,63}$/),
  label: i18nSchema,
  description: i18nSchema.optional(),
  type: z.enum(APPROVAL_FIELD_TYPES),
  required: z.boolean(),
  sensitive: z.boolean(),
  exposeToOwner: z.boolean(),
  defaultValue: z.union([z.string().max(1000), z.number(), z.boolean()]).optional(),
  options: z.array(optionSchema).max(50).optional(),
});
const stepConfigSchema = z.object({
  name: i18nSchema.optional(),
  description: i18nSchema.optional(),
  timeoutSeconds: z.number().int().min(5).max(3600),
  failurePolicy: z.enum(["STOP", "SKIP"]),
  runBuiltIn: z.boolean().optional(),
  inputBindings: z.record(z.string(), z.string().max(200)),
  requests: z.array(z.object({
    id: z.string().regex(/^[a-z][a-zA-Z0-9_-]{0,63}$/),
    name: i18nSchema,
    timing: z.enum(["BEFORE", "AFTER"]),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    urlTemplate: z.string().trim().min(1).max(2000).regex(/^https:\/\//),
    headers: z.array(z.object({ name: z.string().regex(/^[A-Za-z0-9-]{1,100}$/), valueTemplate: z.string().max(2000) })).max(30),
    bodyTemplate: z.string().max(50_000).optional(),
    expectedStatuses: z.string().regex(/^\d{3}(?:-\d{3})?(?:,\s*\d{3}(?:-\d{3})?)*$/),
    captureVariable: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,63}$/).optional(),
  })).max(30).optional(),
});
const definitionSchema = z.object({
  formatVersion: z.literal(1),
  meta: z.object({ name: i18nSchema, resourceType: z.string().trim().regex(/^[a-z][a-z0-9_-]{0,63}$/) }),
  approvalFields: z.array(approvalFieldSchema).max(50).optional(),
  steps: z.array(z.enum(WORKFLOW_STEPS as [ProvisioningStepType, ...ProvisioningStepType[]])).min(1),
  stepConfigs: z.partialRecord(z.enum(WORKFLOW_STEPS as [ProvisioningStepType, ...ProvisioningStepType[]]), stepConfigSchema).optional(),
  detailModules: z.array(z.enum(DETAIL_MODULES)).min(1),
}).superRefine((definition, ctx) => {
  if (new Set(definition.steps).size !== definition.steps.length) ctx.addIssue({ code: "custom", path: ["steps"], message: "duplicate_steps" });
  if (new Set(definition.detailModules).size !== definition.detailModules.length) ctx.addIssue({ code: "custom", path: ["detailModules"], message: "duplicate_modules" });
  const fields = definition.approvalFields ?? [];
  if (new Set(fields.map((field) => field.key)).size !== fields.length) ctx.addIssue({ code: "custom", path: ["approvalFields"], message: "duplicate_approval_fields" });
  fields.forEach((field, index) => {
    if (field.type === "select" && !field.options?.length) ctx.addIssue({ code: "custom", path: ["approvalFields", index, "options"], message: "select_options_required" });
    if (field.sensitive && field.type !== "password") ctx.addIssue({ code: "custom", path: ["approvalFields", index, "sensitive"], message: "sensitive_field_must_be_password" });
  });
  for (const [step, config] of Object.entries(definition.stepConfigs ?? {})) {
    const requests = config?.requests ?? [];
    if (new Set(requests.map((request) => request.id)).size !== requests.length) ctx.addIssue({ code: "custom", path: ["stepConfigs", step, "requests"], message: "duplicate_request_ids" });
    requests.forEach((request, requestIndex) => request.headers.forEach((header, headerIndex) => {
      if (["authorization", "x-api-key", "proxy-authorization"].includes(header.name.toLowerCase()) && !header.valueTemplate.includes("{{")) {
        ctx.addIssue({ code: "custom", path: ["stepConfigs", step, "requests", requestIndex, "headers", headerIndex], message: "secret_header_must_use_variable" });
      }
    }));
  }
});

function defaultApprovalFields(resourceType: string): ApprovalField[] {
  if (resourceType !== "database") return [];
  return [
    { key: "databaseEngine", label: { zh: "数据库引擎", en: "Database engine" }, type: "select", required: true, sensitive: false, exposeToOwner: true, defaultValue: "postgresql", options: ["postgresql", "mysql", "redis", "mongodb"].map((value) => ({ value, label: { zh: value, en: value } })) },
    { key: "databaseName", label: { zh: "数据库名称", en: "Database name" }, type: "text", required: true, sensitive: false, exposeToOwner: true, defaultValue: "app" },
    { key: "databaseAdminUser", label: { zh: "数据库管理员账号", en: "Database admin user" }, type: "text", required: true, sensitive: false, exposeToOwner: true, defaultValue: "app_admin" },
    { key: "databaseAdminPassword", label: { zh: "数据库管理员密码", en: "Database admin password" }, type: "password", required: true, sensitive: true, exposeToOwner: true },
    { key: "databasePort", label: { zh: "数据库端口", en: "Database port" }, type: "number", required: true, sensitive: false, exposeToOwner: true, defaultValue: 5432 },
  ];
}

function defaultStepConfig(step: ProvisioningStepType): StepConfig {
  return {
    description: STEP_DESCRIPTIONS[step],
    timeoutSeconds: step === "DATABASE_BOOTSTRAP" ? 600 : step === "CLOUD_INIT" ? 300 : 120,
    failurePolicy: step === "NOTIFY" ? "SKIP" : "STOP",
    runBuiltIn: true,
    inputBindings: Object.fromEntries(STEP_INPUT_SPECS[step].map((input) => [input.key, input.defaultBinding])),
    requests: [],
  };
}

export function parseWorkflowDefinition(input: unknown): WorkflowDefinition | null {
  const parsed = definitionSchema.safeParse(input);
  if (!parsed.success) return null;
  const legacyDatabase = parsed.data.meta.resourceType === "database" && parsed.data.approvalFields === undefined && parsed.data.stepConfigs === undefined;
  const steps = legacyDatabase && !parsed.data.steps.includes("DATABASE_BOOTSTRAP")
    ? [...parsed.data.steps.slice(0, parsed.data.steps.indexOf("CLOUD_INIT") + 1), "DATABASE_BOOTSTRAP" as ProvisioningStepType, ...parsed.data.steps.slice(parsed.data.steps.indexOf("CLOUD_INIT") + 1)]
    : parsed.data.steps;
  return {
    ...parsed.data,
    steps,
    approvalFields: parsed.data.approvalFields ?? defaultApprovalFields(parsed.data.meta.resourceType),
    stepConfigs: Object.fromEntries(steps.map((step) => {
      const defaults = defaultStepConfig(step);
      const stored = parsed.data.stepConfigs?.[step];
      return [step, stored ? { ...defaults, ...stored, runBuiltIn: stored.runBuiltIn ?? true, requests: stored.requests ?? [] } : defaults];
    })),
  };
}

export function blankWorkflowDefinition(name: I18nText, resourceType: string): WorkflowDefinition {
  const steps = resourceType === "database" ? [...WORKFLOW_STEPS] : WORKFLOW_STEPS.filter((step) => step !== "DATABASE_BOOTSTRAP");
  return { formatVersion: 1, meta: { name, resourceType }, approvalFields: defaultApprovalFields(resourceType), steps, stepConfigs: Object.fromEntries(steps.map((step) => [step, defaultStepConfig(step)])), detailModules: DETAIL_MODULES.filter((m) => m !== "logs") };
}

export function validateApprovalInputs(definition: WorkflowDefinition, input: unknown): { ok: true; values: Record<string, string | number | boolean> } | { ok: false } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return definition.approvalFields.length ? { ok: false } : { ok: true, values: {} };
  const source = input as Record<string, unknown>;
  const values: Record<string, string | number | boolean> = {};
  for (const field of definition.approvalFields) {
    let value = source[field.key] ?? field.defaultValue;
    if (field.type === "number" && typeof value === "string" && value.trim()) value = Number(value);
    if (field.type === "boolean" && typeof value !== "boolean") value = value === "true";
    const missing = value === undefined || value === null || value === "";
    if (field.required && missing) return { ok: false };
    if (missing) continue;
    if (field.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) return { ok: false };
    if (field.type === "boolean" && typeof value !== "boolean") return { ok: false };
    if (["text", "password", "select"].includes(field.type) && typeof value !== "string") return { ok: false };
    if (field.type === "select" && !field.options?.some((option) => option.value === value)) return { ok: false };
    if (typeof value === "string" && value.length > 1000) return { ok: false };
    values[field.key] = value as string | number | boolean;
  }
  return { ok: true, values };
}
