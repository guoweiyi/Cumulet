import { z } from "zod";
import type { ProvisioningStepType } from "@prisma/client";
import type { I18nText } from "@/i18n/config";

export const WORKFLOW_STEPS: ProvisioningStepType[] = [
  "VALIDATE_VMID",
  "CLOUD_INIT",
  "PVE_SECURITY_GROUP",
  "EXTERNAL_ACCESS",
  "JS_ASSET",
  "JS_PERMISSION",
  "NOTIFY",
];

export const DETAIL_MODULES = [
  "summary",
  "connection",
  "configuration",
  "ai",
  "monitoring",
  "logs",
  "console",
] as const;

export type DetailModule = (typeof DETAIL_MODULES)[number];

export type WorkflowDefinition = {
  formatVersion: 1;
  meta: {
    name: I18nText;
    resourceType: string;
  };
  steps: ProvisioningStepType[];
  detailModules: DetailModule[];
};

const i18nSchema = z.object({
  zh: z.string().trim().min(1).max(200),
  en: z.string().trim().max(200).optional(),
});

const definitionSchema = z.object({
  formatVersion: z.literal(1),
  meta: z.object({
    name: i18nSchema,
    resourceType: z.string().trim().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  }),
  steps: z.array(z.enum(WORKFLOW_STEPS as [ProvisioningStepType, ...ProvisioningStepType[]])).min(1),
  detailModules: z.array(z.enum(DETAIL_MODULES)).min(1),
}).superRefine((definition, ctx) => {
  if (new Set(definition.steps).size !== definition.steps.length) {
    ctx.addIssue({ code: "custom", path: ["steps"], message: "duplicate_steps" });
  }
  if (new Set(definition.detailModules).size !== definition.detailModules.length) {
    ctx.addIssue({ code: "custom", path: ["detailModules"], message: "duplicate_modules" });
  }
});

export function parseWorkflowDefinition(input: unknown): WorkflowDefinition | null {
  const parsed = definitionSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function blankWorkflowDefinition(
  name: I18nText,
  resourceType: string,
): WorkflowDefinition {
  return {
    formatVersion: 1,
    meta: { name, resourceType },
    steps: [...WORKFLOW_STEPS],
    detailModules: [...DETAIL_MODULES],
  };
}
