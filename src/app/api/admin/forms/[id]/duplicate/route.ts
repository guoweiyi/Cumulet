import { api, json } from "@/lib/api";
import { requireAdminWrite } from "@/lib/guards";
import { audit } from "@/lib/audit";
import { duplicateForm } from "@/lib/form-service";

type Ctx = { params: Promise<{ id: string }> };

/** Copy a form into a new family as a fresh draft. */
export const POST = api<Ctx>(async (_req, ctx) => {
  const user = await requireAdminWrite();
  const { id } = await ctx.params;
  const copy = await duplicateForm(id, user.id);
  await audit({ actorId: user.id, action: "form.duplicate", targetType: "FormSchema", targetId: copy.id });
  return json({ schema: copy }, 201);
});
