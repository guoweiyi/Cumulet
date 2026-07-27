import { api, json } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/guards";
import { jumpServerClient, JumpServerError } from "@/lib/jumpserver";

export const POST = api(async () => {
  const user = await requireSuperAdmin();
  try {
    const js = await jumpServerClient(user.id);
    await js.testConnection();
    return json({ ok: true });
  } catch (err) {
    const message = err instanceof JumpServerError ? err.message : "Connection failed";
    return json({ ok: false, message }, 502);
  }
});
