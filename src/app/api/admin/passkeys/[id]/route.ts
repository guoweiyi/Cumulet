import { NextRequest } from "next/server";
import { api, json, notFound } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guards";
import { audit } from "@/lib/audit";

export const DELETE = api<{ params: Promise<{ id: string }> }>(async (_req: NextRequest, ctx) => {
  const user = await requireAdmin();
  const { id } = await ctx.params;
  // Scoped to the caller's own credential — admins cannot delete others' keys.
  const cred = await prisma.webAuthnCredential.findFirst({
    where: { id, adminCredential: { userId: user.id } },
  });
  if (!cred) throw notFound();
  await prisma.webAuthnCredential.delete({ where: { id: cred.id } });
  await audit({ actorId: user.id, action: "auth.passkey.deleted", targetId: cred.id });
  return json({ ok: true });
});
