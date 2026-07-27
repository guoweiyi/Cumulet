import { api, badRequest, json, notFound } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAdminWrite } from "@/lib/guards";
import { retryStep, skipStep, STEP_ORDER } from "@/lib/pipeline";
import type { ProvisioningStepType } from "@prisma/client";

type Ctx = { params: Promise<{ id: string; step: string; action: string }> };

/** Per-step retry / skip. Idempotent steps make retry safe. */
export const POST = api<Ctx>(async (_req, ctx) => {
  const user = await requireAdminWrite();
  const { id, step, action } = await ctx.params;
  if (!STEP_ORDER.includes(step as ProvisioningStepType)) throw badRequest("invalid_step");
  if (action !== "retry" && action !== "skip") throw badRequest("invalid_action");

  const binding = await prisma.resourceBinding.findUnique({ where: { id } });
  if (!binding) throw notFound();

  if (action === "retry") {
    await retryStep(id, step as ProvisioningStepType, user.id);
  } else {
    await skipStep(id, step as ProvisioningStepType, user.id);
  }
  const steps = await prisma.provisioningStep.findMany({
    where: { bindingId: id },
    orderBy: { createdAt: "asc" },
    select: { step: true, status: true, errorMessage: true },
  });
  return json({ ok: true, steps });
});
