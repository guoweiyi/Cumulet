import { NextRequest } from "next/server";
import { api, json } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guards";

/** Paginated audit log (?cursor=&action=). */
export const GET = api(async (req: NextRequest) => {
  await requireAdmin();
  const cursor = req.nextUrl.searchParams.get("cursor");
  const action = req.nextUrl.searchParams.get("action");
  const logs = await prisma.auditLog.findMany({
    where: action ? { action: { contains: action } } : {},
    orderBy: { createdAt: "desc" },
    take: 51,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { actor: { select: { email: true, nickname: true } } },
  });
  const hasMore = logs.length > 50;
  const page = logs.slice(0, 50);
  return json({
    logs: page.map((l) => ({
      id: l.id,
      action: l.action,
      actor: l.actor ? (l.actor.nickname ?? l.actor.email) : null,
      targetType: l.targetType,
      targetId: l.targetId,
      metadata: l.metadata,
      createdAt: l.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
});
