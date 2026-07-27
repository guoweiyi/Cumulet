import { api, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireOnboardedUser } from "@/lib/guards";
import type { FormDefinition } from "@/lib/form-engine";

/** The currently published request form, for the client request page. */
export const GET = api(async () => {
  await requireOnboardedUser();
  const schema = await prisma.formSchema.findFirst({
    where: { status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
  });
  if (!schema) return json({ schema: null });
  return json({
    schema: {
      id: schema.id,
      version: schema.version,
      definition: schema.definition as unknown as FormDefinition,
    },
  });
});
