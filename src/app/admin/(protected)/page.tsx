import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guards";
import { Card, CardContent } from "@/components/ui/card";

export default async function AdminOverviewPage() {
  await requireAdmin();
  const t = await getTranslations("admin.overview");

  const [pending, provisioning, active, failedSteps] = await Promise.all([
    prisma.ticket.count({ where: { status: "PENDING" } }),
    prisma.ticket.count({ where: { status: "PROVISIONING" } }),
    prisma.ticket.count({ where: { status: "ACTIVE" } }),
    prisma.provisioningStep.count({ where: { status: "FAILED" } }),
  ]);

  const stats = [
    { label: t("pendingTickets"), value: pending, href: "/admin/tickets?status=PENDING", color: "text-amber-600" },
    { label: t("provisioning"), value: provisioning, href: "/admin/tickets?status=PROVISIONING", color: "text-cyan-600" },
    { label: t("activeResources"), value: active, href: "/admin/resources", color: "text-emerald-600" },
    { label: t("failedPipelines"), value: failedSteps, href: "/admin/tickets?status=PROVISIONING", color: "text-red-600" },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {stats.map((s) => (
        <Link key={s.label} href={s.href}>
          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="p-5">
              <div className={`text-3xl font-semibold ${s.color}`}>{s.value}</div>
              <div className="mt-1 text-sm text-neutral-500">{s.label}</div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
