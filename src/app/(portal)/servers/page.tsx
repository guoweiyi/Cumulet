import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Server } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/guards";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export default async function ServersPage() {
  const user = await requireUser();
  const t = await getTranslations("vm");
  const tt = await getTranslations("ticket");
  const locale = await getLocale();

  const bindings = await prisma.resourceBinding.findMany({
    where: {
      ticket: { userId: user.id, status: "ACTIVE" },
      resource: { status: "ACTIVE" },
    },
    orderBy: { boundAt: "desc" },
    include: {
      pveNode: { select: { name: true } },
      ticket: { select: { status: true } },
    },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-lg font-semibold">{t("myServers")}</h1>
      {bindings.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center text-sm text-neutral-400">
            {t("empty")}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {bindings.map((b) => (
            <Link key={b.id} href={`/servers/${b.id}`} className="group">
              <Card className="shadow-card transition-all group-hover:border-brand/40 group-hover:shadow-card-hover">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex size-11 items-center justify-center rounded-lg border bg-secondary/60 text-brand">
                    <Server className="size-5" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">VM {b.vmid}</span>
                      <Badge
                        variant="secondary"
                        className={
                          b.ticket.status === "ACTIVE"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-700"
                        }
                      >
                        {tt(`status.${b.ticket.status}`)}
                      </Badge>
                    </div>
                    <p className="tnum mt-0.5 truncate text-xs text-muted-foreground">
                      {b.internalIp} · {b.pveNode.name} · {b.boundAt.toLocaleDateString(locale)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
