import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { api, badRequest, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireOnboardedUser, requireUser } from "@/lib/guards";
import { audit } from "@/lib/audit";
import { validateSubmission, type FormDefinition } from "@/lib/form-engine";
import { LIMITS, rateLimit } from "@/lib/rate-limit";

/** The caller's own tickets — never anyone else's. */
export const GET = api(async () => {
  const user = await requireUser();
  const tickets = await prisma.ticket.findMany({
    where: { userId: user.id, sourceInspection: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      formSchema: { select: { definition: true } },
    },
  });
  return json({ tickets });
});

/** Submit a resource request against the currently published form. */
export const POST = api(async (req: NextRequest) => {
  const user = await requireOnboardedUser();
  rateLimit("ticketCreate", user.id, LIMITS.ticketCreate.max, LIMITS.ticketCreate.windowMs);

  const body = await req.json().catch(() => null);
  if (!body || typeof body.schemaId !== "string" || typeof body.values !== "object" || !body.values) {
    throw badRequest();
  }

  const schema = await prisma.formSchema.findUnique({ where: { id: body.schemaId } });
  // Submissions are only accepted against the live published version.
  if (!schema || schema.status !== "PUBLISHED") throw badRequest("schema_not_active");

  const definition = schema.definition as unknown as FormDefinition;
  // Server-side re-validation: recompute visibility, strip hidden fields.
  const result = validateSubmission(definition, body.values as Record<string, unknown>);
  if (!result.ok) return json({ error: { code: "validation", fields: result.errors } }, 422);

  const ticket = await prisma.ticket.create({
    data: {
      userId: user.id,
      formSchemaId: schema.id,
      values: result.cleaned as Prisma.InputJsonValue,
      status: "PENDING",
    },
  });
  await audit({ actorId: user.id, action: "ticket.create", targetType: "Ticket", targetId: ticket.id });
  return json({ ticket: { id: ticket.id } }, 201);
});
