import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json, ApiError } from "@/lib/api";
import { requireAdmin, requireAdminWrite } from "@/lib/guards";
import { provisionExternalAccess } from "@/lib/networking";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  resourceId: z.string().min(1),
  gatewayId: z.string().min(1),
  protocol: z.enum(["TCP", "HTTP", "HTTPS"]),
  internalPort: z.number().int().min(1).max(65535),
  externalPort: z.number().int().min(1).max(65535).nullable().optional(),
  hostname: z.string().trim().min(1).max(255).nullable().optional(),
  dnsZoneId: z.string().min(1).optional(),
  ttl: z.number().int().min(30).max(86400).default(300),
});

/**
 * @swagger
 * /api/admin/external-access:
 *   get:
 *     tags: [External Access]
 *     summary: List FRP and split-DNS mappings
 *     responses:
 *       200: { description: Mapping collection }
 *   post:
 *     tags: [External Access]
 *     summary: Create and reconcile an external-access mapping
 *     responses:
 *       201: { description: Mapping applied }
 *       202: { description: Mapping persisted but gateway reconciliation failed }
 *       400: { description: Invalid mapping }
 */

export const GET = api(async () => {
  await requireAdmin();
  return json({
    mappings: await prisma.externalAccessMapping.findMany({
      orderBy: { createdAt: "desc" },
      include: { gateway: { select: { id: true, name: true, publicHost: true, mode: true } }, dnsRecords: true },
    }),
  });
});

export const POST = api(async (req: NextRequest) => {
  const actor = await requireAdminWrite();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_external_access");
  const data = parsed.data;
  if (data.protocol === "TCP" && !data.externalPort) throw badRequest("external_port_required");
  if (data.protocol !== "TCP" && !data.hostname) throw badRequest("hostname_required");
  try {
    return json({ mapping: await provisionExternalAccess(data, actor.id) }, 201);
  } catch (error) {
    const code = error instanceof Error ? error.message : "external_access_failed";
    if (code.endsWith("_mismatch") || code.endsWith("_not_found")) throw badRequest(code);
    throw new ApiError(502, "external_access_failed", code);
  }
});
