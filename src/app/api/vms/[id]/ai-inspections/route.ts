import { NextRequest } from "next/server";
import { api, ApiError, json } from "@/lib/api";
import { requireBindingAccess } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { runAiInspection } from "@/lib/ai";
import { LIMITS, rateLimit } from "@/lib/rate-limit";

type Ctx = { params: Promise<{ id: string }> };

export const GET = api<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  await requireBindingAccess(id);
  const inspections = await prisma.aiInspectionLog.findMany({
    where: { bindingId: id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      trigger: true,
      status: true,
      severity: true,
      healthScore: true,
      analysis: true,
      createdAt: true,
      finishedAt: true,
    },
  });
  return json({
    inspections: inspections.map((inspection) => ({
      ...inspection,
      createdAt: inspection.createdAt.toISOString(),
      finishedAt: inspection.finishedAt?.toISOString() ?? null,
    })),
  });
});

export const POST = api<Ctx>(async (_req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const { user, binding } = await requireBindingAccess(id, { write: true });
  if (binding.ticket.status !== "ACTIVE") throw new ApiError(409, "resource_not_active");
  rateLimit("aiInspection", user.id, LIMITS.aiInspection.max, LIMITS.aiInspection.windowMs);
  try {
    const result = await runAiInspection({
      bindingId: id,
      requestedById: user.id,
      trigger: user.role === "USER" ? "USER_ON_DEMAND" : "ADMIN_ON_DEMAND",
      locale: user.preferredLocale === "en" ? "en" : "zh",
      allowAlertTicket: false,
    });
    return json({ inspection: result }, 201);
  } catch {
    throw new ApiError(502, "ai_inspection_failed");
  }
});
