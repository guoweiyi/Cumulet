import { NextRequest } from "next/server";
import { api, badRequest, json } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/guards";
import { sendTestMail } from "@/lib/mailer";

export const POST = api(async (req: NextRequest) => {
  const user = await requireSuperAdmin();
  const body = await req.json().catch(() => ({}));
  const to = typeof body.to === "string" ? body.to.trim() : user.email;
  if (!to || !to.includes("@")) throw badRequest("invalid_email");
  try {
    await sendTestMail(to);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, message: err instanceof Error ? err.message : "failed" }, 502);
  }
});
