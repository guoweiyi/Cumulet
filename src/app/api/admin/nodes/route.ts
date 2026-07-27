import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireAdminWrite } from "@/lib/guards";
import { audit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";

const nodeSchema = z.object({
  name: z.string().min(1).max(64),
  nodeName: z.string().min(1).max(64),
  apiUrl: z.string().url().max(255).refine((u) => u.startsWith("https://") || u.startsWith("http://")),
  tokenId: z.string().min(3).max(128),
  tokenSecret: z.string().max(256).optional().default(""),
  tlsVerify: z.boolean().default(true),
});

export const GET = api(async () => {
  await requireAdmin();
  const nodes = await prisma.pveNode.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      nodeName: true,
      apiUrl: true,
      tokenId: true,
      tlsVerify: true,
      verified: true,
      verifiedAt: true,
      _count: { select: { bindings: true } },
      // tokenSecretEnc intentionally omitted — write-only
    },
  });
  return json({ nodes });
});

export const POST = api(async (req: NextRequest) => {
  const user = await requireAdminWrite();
  const parsed = nodeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_node");
  const { tokenSecret, ...rest } = parsed.data;
  if (!tokenSecret) throw badRequest("secret_required");

  const node = await prisma.pveNode.create({
    data: {
      ...rest,
      tokenSecretEnc: encryptSecret(tokenSecret),
      providerInstance: {
        create: {
          name: `pve:${rest.name}`,
          type: "PROXMOX",
          status: "ERROR",
          config: {},
        },
      },
    },
  });
  await audit({ actorId: user.id, action: "pve.node.create", targetType: "PveNode", targetId: node.id });
  return json({ node: { id: node.id } }, 201);
});
