import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireAdminWrite } from "@/lib/guards";
import { onAllNodes } from "@/lib/firewall-admin";
import { isValidCidr } from "@/lib/firewall";

type Ctx = { params: Promise<{ name: string }> };
const nameSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{1,30}$/);

/** Add an entry to the IPSet (body: { cidr, comment? }). */
export const POST = api<Ctx>(async (req: NextRequest, ctx) => {
  const user = await requireAdminWrite();
  const { name } = await ctx.params;
  if (!nameSchema.safeParse(name).success) throw badRequest();
  const body = await req.json().catch(() => ({}));
  const cidr = typeof body.cidr === "string" ? body.cidr : "";
  if (!isValidCidr(cidr)) throw badRequest("invalid_cidr");
  const comment = typeof body.comment === "string" ? body.comment.slice(0, 120) : undefined;

  const { failures } = await onAllNodes(user.id, async (client) => {
    const entries = await client.listIpsetEntries(name);
    if (!entries.some((e) => e.cidr === cidr)) {
      await client.addIpsetEntry(name, cidr, comment);
    }
  });
  await audit({
    actorId: user.id,
    action: "firewall.ipset.entry.add",
    targetId: name,
    metadata: { cidr, failures },
  });
  return json({ ok: failures.length === 0, failures }, 201);
});

/** Delete the IPSet (?cidr= deletes a single entry instead). */
export const DELETE = api<Ctx>(async (req: NextRequest, ctx) => {
  const user = await requireAdminWrite();
  const { name } = await ctx.params;
  if (!nameSchema.safeParse(name).success) throw badRequest();
  const cidr = req.nextUrl.searchParams.get("cidr");

  if (cidr) {
    if (!isValidCidr(cidr)) throw badRequest("invalid_cidr");
    const { failures } = await onAllNodes(user.id, (client) => client.deleteIpsetEntry(name, cidr));
    await audit({
      actorId: user.id,
      action: "firewall.ipset.entry.delete",
      targetId: name,
      metadata: { cidr, failures },
    });
    return json({ ok: failures.length === 0, failures });
  }

  const { failures } = await onAllNodes(user.id, async (client) => {
    for (const e of await client.listIpsetEntries(name).catch(() => [])) {
      await client.deleteIpsetEntry(name, e.cidr);
    }
    await client.deleteIpset(name);
  });
  await audit({ actorId: user.id, action: "firewall.ipset.delete", targetId: name, metadata: { failures } });
  return json({ ok: failures.length === 0, failures });
});
