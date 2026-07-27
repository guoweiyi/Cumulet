import { api, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/guards";

/** The caller's own VM bindings (server list page data). */
export const GET = api(async () => {
  const user = await requireUser();
  const bindings = await prisma.resourceBinding.findMany({
    where: { ticket: { userId: user.id } },
    orderBy: { boundAt: "desc" },
    select: {
      id: true,
      vmid: true,
      internalIp: true,
      cloudInitUser: true,
      boundAt: true,
      pveNode: { select: { name: true } },
      ticket: { select: { status: true } },
    },
  });
  return json({ bindings });
});
