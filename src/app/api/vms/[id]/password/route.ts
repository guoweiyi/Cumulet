import { api, forbidden, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { emailPasswordReset } from "@/lib/emails";
import { prisma } from "@/lib/prisma";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { generateVmPassword, mapPveError, vmContext } from "@/lib/vm";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Owner-triggered Cloud-Init password reset. The new password is returned
 * exactly once in this response (over the authenticated session) and is
 * never persisted in plaintext or logged.
 */
export const POST = api<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { binding, client, userId, owner } = await vmContext(id, { write: true });
  if (!owner) throw forbidden(); // admins bind, users own their credentials
  rateLimit("passwordReset", userId, LIMITS.passwordReset.max, LIMITS.passwordReset.windowMs);

  const password = generateVmPassword();
  try {
    await client.setConfig(binding.vmid, { cipassword: password });
    await client.regenerateCloudInit(binding.vmid);
  } catch (err) {
    mapPveError(err);
  }

  await audit({
    actorId: userId,
    action: "vm.password_reset",
    targetType: "ResourceBinding",
    targetId: binding.id,
    metadata: { vmid: binding.vmid },
  });
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user) void emailPasswordReset(user.id, user.email, `VM ${binding.vmid}`);

  return json({ password, rebootRequired: true });
});
