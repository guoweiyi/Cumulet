import { NextRequest } from "next/server";
import { z } from "zod";
import { api, badRequest, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireAdminWrite } from "@/lib/guards";
import { audit } from "@/lib/audit";
import { blankDefinition, importDefinition } from "@/lib/form-service";
import type { FormDefinition } from "@/lib/form-engine";

export const GET = api(async () => {
  await requireAdmin();
  const schemas = await prisma.formSchema.findMany({
    orderBy: [{ familyKey: "asc" }, { version: "desc" }],
    select: {
      id: true,
      familyKey: true,
      version: true,
      status: true,
      definition: true,
      createdAt: true,
      updatedAt: true,
      publishedAt: true,
      _count: { select: { tickets: true } },
    },
  });
  return json({
    schemas: schemas.map((s) => {
      const def = s.definition as unknown as FormDefinition;
      return {
        id: s.id,
        familyKey: s.familyKey,
        version: s.version,
        status: s.status,
        name: def.meta?.name ?? { zh: "" },
        fieldCount: def.fields?.length ?? 0,
        ticketCount: s._count.tickets,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        publishedAt: s.publishedAt?.toISOString() ?? null,
      };
    }),
  });
});

const createSchema = z.object({
  name: z.object({ zh: z.string().min(1).max(200), en: z.string().max(200).optional() }),
});

/** Create a new form family (version 1, DRAFT) from a blank definition. */
export const POST = api(async (req: NextRequest) => {
  const user = await requireAdminWrite();
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw badRequest("invalid_form");

  const result = await importDefinition(blankDefinition(parsed.data.name) as FormDefinition, user.id);
  if (!result.ok) throw badRequest("invalid_form");
  await audit({ actorId: user.id, action: "form.create", targetType: "FormSchema", targetId: result.id });
  return json({ schema: { id: result.id } }, 201);
});
