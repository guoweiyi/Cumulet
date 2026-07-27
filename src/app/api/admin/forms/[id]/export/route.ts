import { NextResponse } from "next/server";
import { api, notFound } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guards";
import type { FormDefinition } from "@/lib/form-engine";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Export the canonical, self-contained definition JSON (no DB ids/timestamps)
 * as a downloadable attachment. Re-importing reproduces the form losslessly.
 */
export const GET = api<Ctx>(async (_req, ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const schema = await prisma.formSchema.findUnique({ where: { id } });
  if (!schema) throw notFound();

  const def = schema.definition as unknown as FormDefinition;
  const filename = `${(def.meta?.name?.en || def.meta?.name?.zh || "form").replace(/[^a-zA-Z0-9-_]+/g, "_")}-v${schema.version}.json`;
  return new NextResponse(JSON.stringify(def, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
