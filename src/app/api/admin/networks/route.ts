import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdmin, requireAdminWrite } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

const createSchema = z.object({
  tenantId: z.string().min(1),
  name: z.string().trim().min(1).max(96),
  routingDomain: z.string().trim().min(1).max(96),
});

/**
 * @swagger
 * /api/admin/networks:
 *   get:
 *     tags: [Networks]
 *     summary: List isolated tenant networks and subnets
 *     responses:
 *       200: { description: Network collection }
 *   post:
 *     tags: [Networks]
 *     summary: Create a routing domain
 *     responses:
 *       201: { description: Network created }
 *       400: { description: Invalid input }
 */

export const GET = api(async () => {
  await requireAdmin();
  return json({
    networks: await prisma.network.findMany({
      orderBy: [{ tenant: { name: "asc" } }, { name: "asc" }],
      include: { tenant: { select: { id: true, name: true, slug: true } }, subnets: true },
    }),
  });
});

export const POST = api(async (req: NextRequest) => {
  const actor = await requireAdminWrite();
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_network");
  const network = await prisma.network.create({ data: { ...parsed.data, createdById: actor.id } });
  await audit({ actorId: actor.id, action: "network.create", targetType: "Network", targetId: network.id });
  return json({ network }, 201);
});
