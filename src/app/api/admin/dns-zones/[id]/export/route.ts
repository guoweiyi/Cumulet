import { api, notFound } from "@/lib/api";
import { requireAdmin } from "@/lib/guards";
import { generateSplitDnsConfig } from "@/lib/networking";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

export const GET = api<Ctx>(async (_req, ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const zone = await prisma.dnsZone.findUnique({
    where: { id },
    include: { records: { orderBy: [{ hostname: "asc" }, { type: "asc" }] } },
  });
  if (!zone) throw notFound();
  const body = zone.records.map(generateSplitDnsConfig).join("\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${zone.domain.replace(/[^a-z0-9.-]/g, "_")}.split-dns.txt"`,
    },
  });
});
