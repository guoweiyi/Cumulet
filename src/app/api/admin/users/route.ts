import { NextRequest } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { api, badRequest, forbidden, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireAdminWrite } from "@/lib/guards";
import { audit } from "@/lib/audit";
import { getDefaultQuota } from "@/lib/settings";
import { canCreateRole } from "@/lib/user-admin-policy";

export const GET = api(async () => {
  await requireAdmin();
  const [users, defaults] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
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
    }),
    getDefaultQuota(),
  ]);
  return json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      nickname: u.nickname,
      realName: u.realName,
      studentId: u.studentId,
      role: u.role,
      preferredLocale: u.preferredLocale,
      createdAt: u.createdAt.toISOString(),
      hasPassword: !!u.adminCredential,
      ticketCount: u._count.tickets,
      resourceCount: u._count.ownedResources,
      quota: u.quota
        ? {
            maxCpuCores: u.quota.maxCpuCores,
            maxRamGB: u.quota.maxRamGB,
            maxDiskGB: u.quota.maxDiskGB,
            maxFirewallRules: u.quota.maxFirewallRules,
          }
        : null,
    })),
    defaultQuota: defaults,
  });
});

const createSchema = z.object({
  email: z.string().email().max(255),
  nickname: z.string().max(64).optional(),
  realName: z.string().min(2).max(64).optional(),
  studentId: z.string().regex(/^\d{1,32}$/).optional(),
  role: z.enum(["USER", "AUDITOR", "ADMIN", "SUPER_ADMIN"]).default("USER"),
  preferredLocale: z.enum(["zh", "en"]).default("zh"),
  password: z.string().min(10).max(200).optional(),
});

/** Create a user manually. ADMIN may create USER; role grants remain SUPER_ADMIN-only. */
export const POST = api(async (req: NextRequest) => {
  const actor = await requireAdminWrite();
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_user");
  const data = parsed.data;
  const email = data.email.trim().toLowerCase();

  if (!canCreateRole(actor.role, data.role)) throw forbidden();
  if (data.role === "USER" && data.password) throw badRequest("password_requires_admin_role");

  const clash = await prisma.user.findUnique({ where: { email } });
  if (clash) throw badRequest("email_taken");

  const adminCapable = data.role !== "USER";
  if (data.password && (!/[a-zA-Z]/.test(data.password) || !/[0-9]/.test(data.password))) {
    throw badRequest("weak_password");
  }

  let user;
  try {
    user = await prisma.user.create({
      data: {
        email,
        nickname: data.nickname ?? email.split("@")[0],
        realName: data.realName ?? null,
        realNameSetAt: data.realName ? new Date() : null,
        studentId: data.studentId ?? null,
        studentIdSetAt: data.studentId ? new Date() : null,
        role: data.role,
        preferredLocale: data.preferredLocale,
        ...(adminCapable && data.password
          ? {
              adminCredential: {
                create: { passwordHash: await bcrypt.hash(data.password, 12) },
              },
            }
          : {}),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String(error.meta?.target ?? "");
      throw badRequest(target.includes("studentId") ? "student_id_in_use" : "email_taken");
    }
    throw error;
  }
  await audit({
    actorId: actor.id,
    action: "user.create",
    targetType: "User",
    targetId: user.id,
    metadata: { email, role: data.role },
  });
  return json({ user: { id: user.id } }, 201);
});
