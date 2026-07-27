import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { TicketStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guards";
import { localized, type I18nText } from "@/i18n/config";
import { STATUS_BADGE } from "@/components/ticket-status";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const STATUSES: (TicketStatus | "ALL")[] = [
  "ALL",
  "PENDING",
  "PROVISIONING",
  "FAILED",
  "ACTIVE",
  "APPROVED",
  "REJECTED",
  "CLOSED",
];

export default async function AdminTicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const t = await getTranslations("ticket");
  const ta = await getTranslations("admin.ticket");
  const tc = await getTranslations("common");
  const locale = await getLocale();
  const { status } = await searchParams;
  const filter = STATUSES.includes(status as TicketStatus) ? (status as TicketStatus) : undefined;

  const tickets = await prisma.ticket.findMany({
    where: filter ? { status: filter } : {},
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      user: { select: { email: true, realName: true, nickname: true } },
      formSchema: { select: { definition: true } },
      sourceInspection: { select: { id: true } },
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">{ta("all")}</h1>
      <div className="flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={s === "ALL" ? "/admin/tickets" : `/admin/tickets?status=${s}`}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              (s === "ALL" && !filter) || filter === s
                ? "border-blue-600 bg-blue-50 text-blue-700"
                : "text-neutral-500 hover:bg-neutral-50",
            )}
          >
            {s === "ALL" ? tc("all") : t(`status.${s}`)}
          </Link>
        ))}
      </div>
      <Card>
        <CardContent className="p-0">
          {tickets.length === 0 ? (
            <p className="py-14 text-center text-sm text-neutral-400">{t("empty")}</p>
          ) : (
            <ul className="divide-y">
              {tickets.map((tk) => (
                <li key={tk.id}>
                  <Link
                    href={`/admin/tickets/${tk.id}`}
                    className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-neutral-50"
                  >
                    <span className="font-mono text-xs text-neutral-400">#{tk.id.slice(-8)}</span>
                    <span className="font-medium">
                      {tk.sourceInspection
                        ? ta("aiAlert")
                        : localized((tk.formSchema.definition as { meta: { name: I18nText } }).meta.name, locale)}
                    </span>
                    <Badge variant="secondary" className={STATUS_BADGE[tk.status]}>
                      {t(`status.${tk.status}`)}
                    </Badge>
                    <span className="text-neutral-500">
                      {tk.user.realName ?? tk.user.nickname} · {tk.user.email}
                    </span>
                    <span className="ml-auto text-xs text-neutral-400">
                      {tk.createdAt.toLocaleString(locale)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
