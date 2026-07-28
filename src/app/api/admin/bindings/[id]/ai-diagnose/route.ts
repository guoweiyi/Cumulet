import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { diagnoseProvisioningFailure } from "@/lib/ai";
import { requireAdminWrite } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };
const schema = z.object({ step: z.string().min(1), locale: z.enum(["zh", "en"]).default("zh") });

export const POST = api<Ctx>(async (req: NextRequest, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_diagnosis_request");
  const binding = await prisma.resourceBinding.findUnique({
    where: { id },
    include: { resource: { include: { provider: { select: { type: true } } } }, steps: true },
  });
  if (!binding) throw notFound();
  const step = binding.steps.find((entry) => entry.step === parsed.data.step && entry.status === "FAILED");
  if (!step?.errorMessage) throw badRequest("step_not_failed");
  const meta = binding.provisionMeta && typeof binding.provisionMeta === "object" && !Array.isArray(binding.provisionMeta)
    ? binding.provisionMeta as Record<string, unknown> : {};
  const diagnosis = await diagnoseProvisioningFailure({
    step: step.step,
    error: step.errorMessage,
    providerType: binding.resource.provider.type,
    resource: { cpuCores: binding.resource.cpuCores, ramGB: binding.resource.ramGB, diskGB: binding.resource.diskGB },
    integrations: { securityGroup: !!binding.pveSecurityGroup, jumpServer: true, externalAccess: !!meta.externalAccess },
    locale: parsed.data.locale,
  });
  await audit({ actorId: actor.id, action: "ai.provisioning_diagnosis", targetType: "ResourceBinding", targetId: id, metadata: { step: step.step, confidence: diagnosis.confidence } });
  return json({ diagnosis });
});
