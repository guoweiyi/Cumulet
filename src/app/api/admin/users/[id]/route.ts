import { NextRequest } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { api, badRequest, forbidden, json, notFound, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireAdminWrite } from "@/lib/guards";
import { audit } from "@/lib/audit";
import { canGrantRoles, canManageUser } from "@/lib/user-admin-policy";

type Ctx = { params: Promise<{ id: string }> };

export const GET = api<Ctx>(async (_req, ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      nickname: true,
      realName: true,
      studentId: true,
      role: true,
      preferredLocale: true,
      createdAt: true,
      quota: true,
      adminCredential: { select: { id: true } },
      _count: { select: { tickets: true, ownedResources: true } },
    },
  });
  if (!user) throw notFound();
  return json({ user });
});

const patchSchema = z.object({
  nickname: z.string().max(64).nullish(),
  email: z.string().email().max(255).optional(),
  realName: z.string().min(2).max(64).nullish(),
  studentId: z.string().regex(/^\d{1,32}$/).nullish(),
  preferredLocale: z.enum(["zh", "en"]).optional(),
  role: z.enum(["USER", "AUDITOR", "ADMIN", "SUPER_ADMIN"]).optional(),
  quota: z
    .object({
      maxCpuCores: z.number().int().min(1).max(256),
      maxRamGB: z.number().int().min(1).max(4096),
      maxDiskGB: z.number().int().min(1).max(1024 * 1024),
      maxFirewallRules: z.number().int().min(0).max(1000),
    })
    .optional(),
  password: z.string().min(10).max(200).optional(),
});

/** ADMIN may update ordinary users; role grants and admin credentials are SUPER_ADMIN-only. */
export const PATCH = api<Ctx>(async (req: NextRequest, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest();
  const { nickname, email, realName, studentId, preferredLocale, role, quota, password } = parsed.data;

  if (!canGrantRoles(actor.role) && (role !== undefined || password !== undefined)) throw forbidden();

  let passwordHash: string | undefined;
  if (password) {
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) throw badRequest("weak_password");
    passwordHash = await bcrypt.hash(password, 12);
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Re-read the target inside the serializable transaction. Role and
      // real-name checks must not rely on a stale pre-transaction snapshot.
      const target = await tx.user.findUnique({ where: { id } });
      if (!target) throw notFound();
      if (!canManageUser(actor.role, target.role)) throw forbidden();

      const nextRole = role ?? target.role;
      if (password && nextRole === "USER") throw badRequest("password_requires_admin_role");

      const userData: Prisma.UserUpdateInput = {};
      if (nickname !== undefined) userData.nickname = nickname;
      if (preferredLocale) userData.preferredLocale = preferredLocale;
      if (role) userData.role = role;
      if (email) {
        const normalized = email.trim().toLowerCase();
        if (normalized !== target.email) userData.email = normalized;
      }

      // An authorized admin may fill an empty real name, but no caller can
      // change it after the first successful write.
      if (realName !== undefined && realName !== null) {
        if (target.realName !== null && target.realName !== realName) {
          throw new ApiError(403, "realname_immutable");
        }
        if (target.realName === null) {
          userData.realName = realName;
          userData.realNameSetAt = new Date();
        }
      }
      if (studentId !== undefined && studentId !== null) {
        if (target.studentId !== null && target.studentId !== studentId) {
          throw new ApiError(403, "student_id_immutable");
        }
        if (target.studentId === null) {
          userData.studentId = studentId;
          userData.studentIdSetAt = new Date();
        }
      }

      // Serializable isolation makes the last-SUPER_ADMIN guard race-safe.
      if (role && target.role === "SUPER_ADMIN" && role !== "SUPER_ADMIN") {
        const supers = await tx.user.count({ where: { role: "SUPER_ADMIN" } });
        if (supers <= 1) throw forbidden();
      }
      if (Object.keys(userData).length > 0) {
        await tx.user.update({ where: { id }, data: userData });
      }
      if (passwordHash) {
        await tx.adminCredential.upsert({
          where: { userId: id },
          create: { userId: id, passwordHash },
          update: { passwordHash, failedLoginCount: 0, lockedUntil: null },
        });
      }
      if (role === "USER" && target.role !== "USER") {
        await tx.adminCredential.deleteMany({ where: { userId: id } });
      }
      if (quota) {
        await tx.userQuota.upsert({
          where: { userId: id },
          create: { userId: id, ...quota },
          update: quota,
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String(error.meta?.target ?? "");
      throw badRequest(target.includes("studentId") ? "student_id_in_use" : "email_taken");
    }
    if (
      error instanceof ApiError &&
      ["realname_immutable", "student_id_immutable"].includes(error.code)
    ) {
      await audit({
        actorId: actor.id,
        action: "user.identity.change_rejected",
        targetType: "User",
        targetId: id,
        metadata: { field: error.code === "realname_immutable" ? "realName" : "studentId" },
      });
    }
    throw error;
  }

  await audit({
    actorId: actor.id,
    action: "user.update",
    targetType: "User",
    targetId: id,
    metadata: { ...parsed.data, password: password ? "***" : undefined },
  });
  return json({ ok: true });
});

/**
 * Delete a user. ADMIN may delete ordinary users; SUPER_ADMIN may delete any
 * non-self account. Blocked when the user still owns tickets or
 * bound resources (reassign/close those first), when deleting yourself, or
 * when removing the last SUPER_ADMIN.
 */
export const DELETE = api<Ctx>(async (_req, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  if (id === actor.id) throw badRequest("cannot_delete_self");

  const target = await prisma.$transaction(async (tx) => {
    const fresh = await tx.user.findUnique({
      where: { id },
      include: { _count: { select: { tickets: true, ownedResources: true, createdFormSchemas: true } } },
    });
    if (!fresh) throw notFound();
    if (!canManageUser(actor.role, fresh.role)) throw forbidden();
    if (fresh.role === "SUPER_ADMIN") {
      const supers = await tx.user.count({ where: { role: "SUPER_ADMIN" } });
      if (supers <= 1) throw forbidden();
    }
    if (fresh._count.tickets > 0 || fresh._count.ownedResources > 0 || fresh._count.createdFormSchemas > 0) {
      throw new ApiError(409, "user_has_resources");
    }
    // AdminCredential/quota cascade; AuditLog.actorId is SET NULL.
    await tx.user.delete({ where: { id } });
    return fresh;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await audit({
    actorId: actor.id,
    action: "user.delete",
    targetType: "User",
    targetId: id,
    metadata: { email: target.email },
  });
  return json({ ok: true });
});
