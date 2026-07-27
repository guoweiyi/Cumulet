import { NextRequest } from "next/server";
import { api, badRequest, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { mapProviderError, vmContext } from "@/lib/vm";
import type { PowerAction } from "@/lib/pve";

type Ctx = { params: Promise<{ id: string }> };

const ACTIONS: PowerAction[] = ["start", "shutdown", "reboot", "stop"];

/**
 * @swagger
 * /api/vms/{id}/power:
 *   post:
 *     tags: [Virtual Machines]
 *     summary: Perform a provider-neutral VM power action
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Provider accepted the action }
 *       403: { description: Mutation not allowed }
 *       404: { description: Resource not found or not owned by the caller }
 */

export const POST = api<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const { binding, provider, userId } = await vmContext(id, { write: true });
  rateLimit("power", userId, LIMITS.power.max, LIMITS.power.windowMs);

  const body = await req.json().catch(() => ({}));
  const action = body.action as PowerAction;
  if (!ACTIONS.includes(action)) throw badRequest("invalid_action");

  try {
    const ref = { providerResourceId: binding.resource.providerResourceId };
    const task = action === "start"
      ? await provider.powerOn(ref)
      : action === "shutdown"
        ? await provider.shutdown(ref)
        : action === "reboot"
          ? await provider.reboot(ref)
          : await provider.forceStop(ref);
    await audit({
      actorId: userId,
      action: `vm.power.${action}`,
      targetType: "ResourceBinding",
      targetId: binding.id,
      metadata: { vmid: binding.vmid },
    });
    return json({ upid: task.taskId, accepted: task.accepted });
  } catch (err) {
    mapProviderError(err);
  }
});
