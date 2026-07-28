import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { api, badRequest, json, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/guards";
import { audit } from "@/lib/audit";

const STUDENT_ID_RE = /^\d{1,32}$/;

export const GET = api(async () => {
  const user = await requireUser();
  return json({ realName: user.realName, studentId: user.studentId });
});

/**
 * Bind immutable identity fields. Repeating an identical submission is
 * idempotent, while attempts to change either bound value are rejected.
 */
export const POST = api(async (req: NextRequest) => {
  const actor = await requireUser();
  const body = await req.json().catch(() => ({}));
  const realName = typeof body.realName === "string" ? body.realName.trim() : "";
  const studentId = typeof body.studentId === "string" ? body.studentId.trim() : "";

  if (realName.length < 2 || realName.length > 64) throw badRequest("invalid_name");
  if (!STUDENT_ID_RE.test(studentId)) throw badRequest("invalid_student_id");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: actor.id } });
      if (!user) throw new ApiError(401, "unauthorized");
      if (user.realName !== null && user.realName !== realName) {
        throw new ApiError(403, "realname_immutable");
      }
      if (user.studentId !== null && user.studentId !== studentId) {
        throw new ApiError(403, "student_id_immutable");
      }

      if (user.realName === realName && user.studentId === studentId) return false;
      const now = new Date();
      await tx.user.update({
        where: { id: user.id },
        data: {
          ...(user.realName === null ? { realName, realNameSetAt: now } : {}),
          ...(user.studentId === null ? { studentId, studentIdSetAt: now } : {}),
        },
      });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (result) {
      await audit({
        actorId: actor.id,
        action: "user.identity.bound",
        targetType: "User",
        targetId: actor.id,
      });
    }
    return json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError(409, "student_id_in_use");
    }
    if (error instanceof ApiError && ["realname_immutable", "student_id_immutable"].includes(error.code)) {
      await audit({
        actorId: actor.id,
        action: "user.identity.change_rejected",
        targetType: "User",
        targetId: actor.id,
        metadata: { field: error.code === "realname_immutable" ? "realName" : "studentId" },
      });
    }
    throw error;
  }
});
