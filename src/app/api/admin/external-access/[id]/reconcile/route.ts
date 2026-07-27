import { api, json } from "@/lib/api";
import { requireAdminWrite } from "@/lib/guards";
import { reconcileExternalAccess } from "@/lib/networking";

type Ctx = { params: Promise<{ id: string }> };
export const POST = api<Ctx>(async (_req, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  return json({ mapping: await reconcileExternalAccess(id, actor.id) });
});
