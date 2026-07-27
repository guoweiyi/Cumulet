import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json, notFound } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAdminWrite } from "@/lib/guards";
import { audit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  nodeName: z.string().min(1).max(64).optional(),
  apiUrl: z.string().url().max(255).optional(),
  tokenId: z.string().min(3).max(128).optional(),
  tokenSecret: z.string().max(256).optional(), // empty/absent = keep
  tlsVerify: z.boolean().optional(),
});

export const PATCH = api<Ctx>(async (req: NextRequest, ctx) => {
  const user = await requireAdminWrite();
  const { id } = await ctx.params;
  const node = await prisma.pveNode.findUnique({ where: { id } });
  if (!node) throw notFound();

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_node");
  const { tokenSecret, ...rest } = parsed.data;

  await prisma.pveNode.update({
    where: { id },
    data: {
      ...rest,
      ...(tokenSecret ? { tokenSecretEnc: encryptSecret(tokenSecret) } : {}),
      // connection details changed → require re-verification
      verified: false,
      verifiedAt: null,
      ...(node.providerInstanceId
        ? {
            providerInstance: {
              update: {
                ...(rest.name ? { name: `pve:${rest.name}` } : {}),
                status: "ERROR" as const,
              },
            },
          }
        : {}),
    },
  });
  await audit({ actorId: user.id, action: "pve.node.update", targetType: "PveNode", targetId: id });
  return json({ ok: true });
});

export const DELETE = api<Ctx>(async (_req, ctx) => {
  const user = await requireAdminWrite();
  const { id } = await ctx.params;
  const node = await prisma.pveNode.findUnique({
    where: { id },
    include: { _count: { select: { bindings: true } } },
  });
  if (!node) throw notFound();
  if (node._count.bindings > 0) throw badRequest("node_has_bindings");
  await prisma.$transaction(async (tx) => {
    await tx.pveNode.delete({ where: { id } });
    if (node.providerInstanceId) {
      await tx.providerInstance.delete({ where: { id: node.providerInstanceId } });
    }
  });
  await audit({ actorId: user.id, action: "pve.node.delete", targetType: "PveNode", targetId: id });
  return json({ ok: true });
});
