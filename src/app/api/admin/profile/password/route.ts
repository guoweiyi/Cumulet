import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { api, badRequest, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guards";
import { audit } from "@/lib/audit";

/** Change the calling admin's own password. */
export const POST = api(async (req: NextRequest) => {
  const user = await requireAdmin();
  const body = await req.json().catch(() => ({}));
  const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const next = typeof body.newPassword === "string" ? body.newPassword : "";

  if (next.length < 10 || !/[a-zA-Z]/.test(next) || !/[0-9]/.test(next)) {
    throw badRequest("weak_password");
  }

  const cred = await prisma.adminCredential.findUnique({ where: { userId: user.id } });
  // If a password already exists, require the current one.
  if (cred?.passwordHash) {
    const ok = await bcrypt.compare(current, cred.passwordHash);
    if (!ok) throw badRequest("wrong_current");
  }
  const hash = await bcrypt.hash(next, 12);
  await prisma.adminCredential.upsert({
    where: { userId: user.id },
    create: { userId: user.id, passwordHash: hash },
    update: { passwordHash: hash, failedLoginCount: 0, lockedUntil: null },
  });
  await audit({ actorId: user.id, action: "auth.password.changed", targetType: "User", targetId: user.id });
  return json({ ok: true });
});
