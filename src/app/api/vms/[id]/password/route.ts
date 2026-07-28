import { api, forbidden, json, ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { emailPasswordReset } from "@/lib/emails";
import { prisma } from "@/lib/prisma";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { PveError } from "@/lib/pve";
import { generateVmPassword, mapPveError, vmContext } from "@/lib/vm";

type Ctx = { params: Promise<{ id: string }> };

/** Reset an existing Linux account through QEMU Guest Agent. */
export const POST = api<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { binding, client, userId, owner } = await vmContext(id, { write: true });
  if (!owner) throw forbidden(); // admins bind, users own their credentials
  rateLimit("passwordReset", userId, LIMITS.passwordReset.max, LIMITS.passwordReset.windowMs);

  const password = generateVmPassword();
  try {
    await client.setLinuxGuestPassword(binding.vmid, binding.cloudInitUser, password);
  } catch (err) {
    if (err instanceof PveError && err.status === 409) {
      throw new ApiError(409, "vm_not_running");
    }
    if (err instanceof PveError && err.path?.includes("/agent/")) {
      throw new ApiError(409, "guest_agent_unavailable");
    }
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

  return json({ password, rebootRequired: false });
});
