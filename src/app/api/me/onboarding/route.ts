import { NextRequest } from "next/server";
import { api, badRequest, json, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/guards";
import { audit } from "@/lib/audit";

/**
 * One-time real-name registration. realName is immutable: any attempt to set
 * it again is rejected with 403 and audit-logged.
 */
export const POST = api(async (req: NextRequest) => {
  const user = await requireUser();
  const body = await req.json().catch(() => ({}));
  const realName = typeof body.realName === "string" ? body.realName.trim() : "";

  if (user.realName !== null) {
    await audit({
      actorId: user.id,
      action: "user.realname.change_rejected",
      targetType: "User",
      targetId: user.id,
    });
    throw new ApiError(403, "realname_immutable");
  }
  if (realName.length < 2 || realName.length > 32) throw badRequest("invalid_name");

  await prisma.user.update({
    where: { id: user.id },
    data: { realName, realNameSetAt: new Date() },
  });
  await audit({
    actorId: user.id,
    action: "user.realname.set",
    targetType: "User",
    targetId: user.id,
  });
  return json({ ok: true });
});
