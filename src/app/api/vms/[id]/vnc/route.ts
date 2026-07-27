import { api, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { mapPveError, vmContext } from "@/lib/vm";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Issue a noVNC session: asks PVE for a vncproxy ticket, then returns
 * - wsToken: AES-GCM-encrypted proxy target (URL + PVE auth header) consumed
 *   by the in-app websocket proxy — opaque to the browser, expires in 60s;
 * - password: the PVE vncticket used as the RFB password (short-lived,
 *   scoped to this single console session — same model as the PVE UI).
 */
export const POST = api<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { binding, client, userId } = await vmContext(id, { write: true });
  rateLimit("console", userId, LIMITS.console.max, LIMITS.console.windowMs);

  try {
    const proxy = await client.vncProxy(binding.vmid);
    const target = client.vncWebsocketTarget(binding.vmid, proxy.port, proxy.ticket);
    const wsToken = encryptSecret(
      JSON.stringify({
        exp: Date.now() + 60_000,
        url: target.url,
        auth: target.headers.Authorization,
        tlsVerify: target.tlsVerify,
      }),
    );
    await audit({
      actorId: userId,
      action: "vm.console_open",
      targetType: "ResourceBinding",
      targetId: binding.id,
      metadata: { vmid: binding.vmid },
    });
    return json({ wsToken, password: proxy.ticket });
  } catch (err) {
    mapPveError(err);
  }
});
