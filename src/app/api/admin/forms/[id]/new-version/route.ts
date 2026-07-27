import { api, json } from "@/lib/api";
import { requireAdminWrite } from "@/lib/guards";
import { audit } from "@/lib/audit";
import { newVersion } from "@/lib/form-service";

type Ctx = { params: Promise<{ id: string }> };

/** Clone a published/archived version into a new editable draft. */
export const POST = api<Ctx>(async (_req, ctx) => {
  const user = await requireAdminWrite();
  const { id } = await ctx.params;
  const draft = await newVersion(id, user.id);
  await audit({ actorId: user.id, action: "form.new_version", targetType: "FormSchema", targetId: draft.id });
  return json({ schema: draft }, 201);
});
