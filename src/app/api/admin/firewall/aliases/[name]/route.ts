import { z } from "zod";
import { api, badRequest, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdminWrite } from "@/lib/guards";
import { onAllNodes } from "@/lib/firewall-admin";

type Ctx = { params: Promise<{ name: string }> };
const nameSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{1,30}$/);

export const DELETE = api<Ctx>(async (_req, ctx) => {
  const user = await requireAdminWrite();
  const { name } = await ctx.params;
  if (!nameSchema.safeParse(name).success) throw badRequest();
  const { failures } = await onAllNodes(user.id, (client) => client.deleteAlias(name));
  await audit({ actorId: user.id, action: "firewall.alias.delete", targetId: name, metadata: { failures } });
  return json({ ok: failures.length === 0, failures });
});
