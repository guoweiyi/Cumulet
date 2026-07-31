import { api, json, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { decryptSecret } from "@/lib/crypto";
import { requireBindingAccess } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { parseWorkflowDefinition } from "@/lib/workflow-definition";

type Ctx = { params: Promise<{ id: string }> };

export const GET = api<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { user, binding } = await requireBindingAccess(id);
  if (!binding.initialPasswordEnc) throw notFound();
  const workflowSchema = binding.workflowSchemaId
    ? await prisma.workflowSchema.findUnique({ where: { id: binding.workflowSchemaId }, select: { definition: true } })
    : null;
  const workflow = workflowSchema ? parseWorkflowDefinition(workflowSchema.definition) : null;
  const meta = binding.provisionMeta && typeof binding.provisionMeta === "object" && !Array.isArray(binding.provisionMeta)
    ? binding.provisionMeta as Record<string, unknown>
    : {};
  const storedInputs = meta.workflowInputs && typeof meta.workflowInputs === "object" && !Array.isArray(meta.workflowInputs)
    ? meta.workflowInputs as Record<string, unknown>
    : {};
  const workflowCredentials = (workflow?.approvalFields ?? []).filter((field) => field.exposeToOwner).flatMap((field) => {
    const stored = storedInputs[field.key];
    if (stored === undefined) return [];
    const value = field.sensitive && stored && typeof stored === "object" && !Array.isArray(stored) && "encrypted" in stored
      ? decryptSecret(String((stored as { encrypted: unknown }).encrypted))
      : stored;
    return [{ key: field.key, label: field.label, sensitive: field.sensitive, value }];
  });
  await audit({
    actorId: user.id,
    action: "vm.initial_credentials_viewed",
    targetType: "ResourceBinding",
    targetId: binding.id,
    metadata: { vmid: binding.vmid },
  });
  return json(
    { username: binding.cloudInitUser, password: decryptSecret(binding.initialPasswordEnc), workflowCredentials },
    { headers: { "Cache-Control": "no-store, private" } },
  );
});
