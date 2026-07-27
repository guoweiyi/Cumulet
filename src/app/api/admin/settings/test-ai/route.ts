import { api, json } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/guards";
import { testAiConnection } from "@/lib/ai";

export const POST = api(async () => {
  await requireSuperAdmin();
  try {
    const response = await testAiConnection();
    return json({ ok: true, response });
  } catch {
    return json({ ok: false, message: "connection_failed" }, 502);
  }
});
