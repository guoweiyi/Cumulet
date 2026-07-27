import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/guards";
import { localized, type I18nText } from "@/i18n/config";
import { STATUS_BADGE } from "@/components/ticket-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default async function TicketsPage() {
  const user = await requireUser();
  const t = await getTranslations("ticket");
  const locale = await getLocale();

  const tickets = await prisma.ticket.findMany({
    where: { userId: user.id, sourceInspection: null },
    orderBy: { createdAt: "desc" },
    include: { formSchema: { select: { definition: true } } },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t("myTickets")}</h1>
        <Button asChild>
          <Link href="/request">{t("newRequest")}</Link>
        </Button>
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
                    href={`/tickets/${tk.id}`}
                    className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-neutral-50"
                  >
                    <span className="font-mono text-xs text-neutral-400">#{tk.id.slice(-8)}</span>
                    <span className="font-medium">
                      {localized((tk.formSchema.definition as { meta: { name: I18nText } }).meta.name, locale)}
                    </span>
                    <Badge variant="secondary" className={STATUS_BADGE[tk.status]}>
                      {t(`status.${tk.status}`)}
                    </Badge>
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
