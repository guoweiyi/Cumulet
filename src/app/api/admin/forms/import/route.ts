import { NextRequest } from "next/server";
import { api, json } from "@/lib/api";
import { requireAdminWrite } from "@/lib/guards";
import { audit } from "@/lib/audit";
import { importDefinition } from "@/lib/form-service";
import { readLimitedText } from "@/lib/http-body";

// Untrusted upload: cap the body so a huge file can't be parsed into memory.
const MAX_BYTES = 256 * 1024;

/**
 * Import a form-definition JSON as a new draft. Strictly validated through the
 * same pathway as every other create; a bad file is rejected with localized,
 * per-issue messages and nothing is saved.
 */
export const POST = api(async (req: NextRequest) => {
  const user = await requireAdminWrite();
  const locale = req.nextUrl.searchParams.get("locale") === "en" ? "en" : "zh";

  const text = await readLimitedText(req, MAX_BYTES);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json({ error: { code: "invalid_json", issues: [{ message: "Invalid JSON" }] } }, 422);
  }

  const result = await importDefinition(parsed, user.id, { locale });
  if (!result.ok) {
    return json({ error: { code: "invalid_definition", issues: result.errors } }, 422);
  }
  await audit({ actorId: user.id, action: "form.import", targetType: "FormSchema", targetId: result.id });
  return json({ schema: { id: result.id } }, 201);
});
