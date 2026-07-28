import { api, json, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { decryptSecret } from "@/lib/crypto";
import { requireBindingAccess } from "@/lib/guards";

type Ctx = { params: Promise<{ id: string }> };

export const GET = api<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { user, binding } = await requireBindingAccess(id);
  if (!binding.initialPasswordEnc) throw notFound();
  await audit({
    actorId: user.id,
    action: "vm.initial_credentials_viewed",
    targetType: "ResourceBinding",
    targetId: binding.id,
    metadata: { vmid: binding.vmid },
  });
  return json(
    { username: binding.cloudInitUser, password: decryptSecret(binding.initialPasswordEnc) },
    { headers: { "Cache-Control": "no-store, private" } },
  );
});
