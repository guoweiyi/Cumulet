import { api, json } from "@/lib/api";
import { requireAdminWrite } from "@/lib/guards";
import { removeExternalAccess } from "@/lib/networking";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = api<Ctx>(async (_req, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  await removeExternalAccess(id, actor.id);
  return json({ ok: true });
});
