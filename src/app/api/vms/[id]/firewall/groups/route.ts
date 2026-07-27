import { NextRequest } from "next/server";
import { api, badRequest, json, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { mapPveError, vmContext } from "@/lib/vm";

type Ctx = { params: Promise<{ id: string }> };

/** Attach a SHARED security group to the caller's own VM. */
export const POST = api<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const { binding, client, userId, owner } = await vmContext(id, { write: true });
  rateLimit("firewall", userId, LIMITS.firewall.max, LIMITS.firewall.windowMs);

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name : "";
  if (!name) throw badRequest();

  // Users may only attach groups explicitly published as SHARED; ADMIN_ONLY
  // groups are invisible to them (404, not 403 — no existence oracle).
  const group = await prisma.securityGroup.findUnique({ where: { name } });
  if (!group || (owner && group.scope !== "SHARED")) throw notFound();

  try {
    const rules = await client.listVmRules(binding.vmid);
    if (!rules.some((r) => r.type === "group" && r.action === name)) {
      await client.addVmRule(binding.vmid, { type: "group", action: name });
    }
    await audit({
      actorId: userId,
      action: "firewall.group.attach",
      targetType: "ResourceBinding",
      targetId: binding.id,
      metadata: { vmid: binding.vmid, group: name },
    });
    return json({ ok: true }, 201);
  } catch (err) {
    mapPveError(err);
  }
});

/** Detach a group (?name=...). */
export const DELETE = api<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const { binding, client, userId, owner } = await vmContext(id, { write: true });
  rateLimit("firewall", userId, LIMITS.firewall.max, LIMITS.firewall.windowMs);

  const name = req.nextUrl.searchParams.get("name") ?? "";
  if (!name) throw badRequest();
  const group = await prisma.securityGroup.findUnique({ where: { name } });
  // Users cannot detach ADMIN_ONLY groups an admin attached.
  if (owner && (!group || group.scope !== "SHARED")) throw notFound();

  try {
    const rules = await client.listVmRules(binding.vmid);
    const rule = rules.find((r) => r.type === "group" && r.action === name);
    if (!rule) throw notFound();
    await client.deleteVmRule(binding.vmid, rule.pos);
    await audit({
      actorId: userId,
      action: "firewall.group.detach",
      targetType: "ResourceBinding",
      targetId: binding.id,
      metadata: { vmid: binding.vmid, group: name },
    });
    return json({ ok: true });
  } catch (err) {
    mapPveError(err);
  }
});
