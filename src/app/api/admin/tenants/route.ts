import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdmin, requireAdminWrite } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

const createSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/),
  name: z.string().trim().min(1).max(128),
});

/**
 * @swagger
 * /api/admin/tenants:
 *   get:
 *     tags: [Tenants]
 *     summary: List tenants
 *     responses:
 *       200: { description: Tenant collection }
 *       403: { description: Admin role required }
 *   post:
 *     tags: [Tenants]
 *     summary: Create a tenant
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [slug, name]
 *             properties:
 *               slug: { type: string, pattern: '^[a-z0-9][a-z0-9-]+[a-z0-9]$' }
 *               name: { type: string }
 *     responses:
 *       201: { description: Tenant created }
 *       400: { description: Invalid input }
 */

export const GET = api(async () => {
  await requireAdmin();
  return json({
    tenants: await prisma.tenant.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { memberships: true, networks: true } } },
    }),
  });
});

export const POST = api(async (req: NextRequest) => {
  const actor = await requireAdminWrite();
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_tenant");
  const tenant = await prisma.tenant.create({ data: { ...parsed.data, createdById: actor.id } });
  await audit({ actorId: actor.id, action: "tenant.create", targetType: "Tenant", targetId: tenant.id });
  return json({ tenant }, 201);
});
