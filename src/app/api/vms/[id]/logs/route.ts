import { api, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { vmContext } from "@/lib/vm";

type Ctx = { params: Promise<{ id: string }> };

/** Activity log for one binding (owner or admin). Metadata is not exposed. */
export const GET = api<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { binding, userId } = await vmContext(id);
  const logs = await prisma.auditLog.findMany({
    where: { targetType: "ResourceBinding", targetId: binding.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { actor: { select: { id: true, nickname: true, email: true } } },
  });
  return json({
    logs: logs.map((l) => ({
      id: l.id,
      action: l.action,
      createdAt: l.createdAt.toISOString(),
      // Show "you" vs admin generically; never leak admin emails to users.
      actor: l.actor ? (l.actor.id === userId ? (l.actor.nickname ?? "me") : "admin") : "system",
    })),
  });
});
