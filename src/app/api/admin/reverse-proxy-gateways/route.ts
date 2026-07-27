import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import { requireAdmin, requireAdminWrite } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  tenantId: z.string().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(96),
  mode: z.enum(["FRP_HTTP_API", "FRPC_CONFIG"]),
  apiUrl: z.string().url().max(512).nullable().optional(),
  publicHost: z.string().trim().min(1).max(255),
  secret: z.string().max(512).optional(),
  tlsVerify: z.boolean().default(true),
});

export const GET = api(async () => {
  await requireAdmin();
  const gateways = await prisma.reverseProxyGateway.findMany({ orderBy: { name: "asc" } });
  return json({ gateways: gateways.map(({ secretEnc, ...gateway }) => ({ ...gateway, secretSet: !!secretEnc })) });
});

export const POST = api(async (req: NextRequest) => {
  const actor = await requireAdminWrite();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || (parsed.data.mode === "FRP_HTTP_API" && !parsed.data.apiUrl)) throw badRequest("invalid_gateway");
  const { secret, ...data } = parsed.data;
  const gateway = await prisma.reverseProxyGateway.create({ data: { ...data, secretEnc: secret ? encryptSecret(secret) : null } });
  await audit({ actorId: actor.id, action: "network.gateway.create", targetType: "ReverseProxyGateway", targetId: gateway.id });
  return json({ gateway: { id: gateway.id } }, 201);
});

