import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdmin, requireAdminWrite } from "@/lib/guards";
import { firstClient, onAllNodes } from "@/lib/firewall-admin";
import { mapPveError } from "@/lib/vm";

const nameSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{1,30}$/);

export const GET = api(async () => {
  const user = await requireAdmin();
  try {
    const client = await firstClient(user.id);
    const ipsets = await client.listIpsets();
    const withEntries = await Promise.all(
      ipsets.map(async (s) => ({
        ...s,
        entries: await client.listIpsetEntries(s.name).catch(() => []),
      })),
    );
    return json({ ipsets: withEntries });
  } catch (err) {
    mapPveError(err);
  }
});

const createSchema = z.object({ name: nameSchema, comment: z.string().max(120).optional() });

export const POST = api(async (req: NextRequest) => {
  const user = await requireAdminWrite();
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest();
  const { failures } = await onAllNodes(user.id, async (client) => {
    const existing = await client.listIpsets();
    if (!existing.some((s) => s.name === parsed.data.name)) {
      await client.createIpset(parsed.data.name, parsed.data.comment);
    }
  });
  await audit({
    actorId: user.id,
    action: "firewall.ipset.create",
    targetId: parsed.data.name,
    metadata: { failures },
  });
  return json({ ok: failures.length === 0, failures }, 201);
});
