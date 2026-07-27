import { api, json } from "@/lib/api";
import { requireAdminWrite } from "@/lib/guards";
import { audit } from "@/lib/audit";
import { publishForm } from "@/lib/form-service";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Publish a draft. The family's previously published version is archived —
 * exactly one active version per family. Old submissions keep their own
 * version's definition untouched.
 */
export const POST = api<Ctx>(async (_req, ctx) => {
  const user = await requireAdminWrite();
  const { id } = await ctx.params;
  await publishForm(id);
  await audit({ actorId: user.id, action: "form.publish", targetType: "FormSchema", targetId: id });
  return json({ ok: true });
});
