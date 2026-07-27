import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdmin, requireAdminWrite } from "@/lib/guards";
import { firstClient, onAllNodes } from "@/lib/firewall-admin";
import { isValidCidr } from "@/lib/firewall";
import { mapPveError } from "@/lib/vm";

const nameSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{1,30}$/);

export const GET = api(async () => {
  const user = await requireAdmin();
  try {
    const client = await firstClient(user.id);
    return json({ aliases: await client.listAliases() });
  } catch (err) {
    mapPveError(err);
  }
});

export const POST = api(async (req: NextRequest) => {
  const user = await requireAdminWrite();
  const body = await req.json().catch(() => ({}));
  const parsed = z
    .object({ name: nameSchema, cidr: z.string(), comment: z.string().max(120).optional() })
    .safeParse(body);
  if (!parsed.success || !isValidCidr(parsed.data.cidr)) throw badRequest();

  const { failures } = await onAllNodes(user.id, async (client) => {
    const existing = await client.listAliases();
    if (existing.some((a) => a.name === parsed.data.name)) {
      await client.updateAlias(parsed.data.name, parsed.data.cidr, parsed.data.comment);
    } else {
      await client.createAlias(parsed.data.name, parsed.data.cidr, parsed.data.comment);
    }
  });
  await audit({
    actorId: user.id,
    action: "firewall.alias.upsert",
    targetId: parsed.data.name,
    metadata: { cidr: parsed.data.cidr, failures },
  });
  return json({ ok: failures.length === 0, failures }, 201);
});
