import { api, json, notFound } from "@/lib/api";
import { requireAdminWrite } from "@/lib/guards";
import { reconcileDnsRecord } from "@/lib/networking";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

export const POST = api<Ctx>(async (_req, ctx) => {
  const actor = await requireAdminWrite();
  const { id } = await ctx.params;
  const zone = await prisma.dnsZone.findUnique({
    where: { id },
    select: { records: { select: { id: true } } },
  });
  if (!zone) throw notFound();
  const results = [];
  for (const record of zone.records) {
    try {
      await reconcileDnsRecord(record.id, actor.id);
      results.push({ id: record.id, ok: true });
    } catch (error) {
      results.push({
        id: record.id,
        ok: false,
        error: error instanceof Error ? error.message : "dns_sync_failed",
      });
    }
  }
  return json({ results });
});
