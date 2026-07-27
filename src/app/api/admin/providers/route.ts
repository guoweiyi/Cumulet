import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { api, badRequest, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import { requireAdmin, requireAdminWrite } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  name: z.string().trim().min(1).max(96),
  type: z.enum(["ESXI", "FNOS", "AWS", "CUSTOM"]),
  config: z.record(z.string(), z.unknown()),
  secret: z.string().max(8192).optional(),
});

export const GET = api(async () => {
  await requireAdmin();
  const providers = await prisma.providerInstance.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, type: true, status: true, config: true,
      verifiedAt: true, createdAt: true, updatedAt: true, secretEnc: true,
      _count: { select: { resources: true } },
    },
  });
  return json({ providers: providers.map(({ secretEnc, ...provider }) => ({ ...provider, secretSet: !!secretEnc })) });
});

export const POST = api(async (req: NextRequest) => {
  const actor = await requireAdminWrite();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || JSON.stringify(parsed.data.config).length > 64 * 1024) throw badRequest("invalid_provider");
  const { secret, ...data } = parsed.data;
  const provider = await prisma.providerInstance.create({
    data: {
      ...data,
      config: data.config as Prisma.InputJsonValue,
      secretEnc: secret ? encryptSecret(secret) : null,
      status: "DISABLED",
    },
    select: { id: true },
  });
  await audit({ actorId: actor.id, action: "provider.create", targetType: "ProviderInstance", targetId: provider.id, metadata: { type: data.type } });
  return json({ provider }, 201);
});

