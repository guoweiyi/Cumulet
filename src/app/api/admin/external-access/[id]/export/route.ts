import { api, notFound } from "@/lib/api";
import { requireAdmin } from "@/lib/guards";
import { generateFrpcIni } from "@/lib/networking";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

export const GET = api<Ctx>(async (_req, ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const mapping = await prisma.externalAccessMapping.findUnique({ where: { id } });
  if (!mapping) throw notFound();
  const body = generateFrpcIni(mapping);
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${mapping.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.frpc.ini"`,
    },
  });
});
