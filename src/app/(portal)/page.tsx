import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight, ChevronRight, ExternalLink, FileText, GitFork, Server, Shield, Ticket } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/guards";
import { getGithub } from "@/lib/settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { STATUS_BADGE } from "@/components/ticket-status";

// Restrained, harmonized icon accents — colour lives only in the thin line
// icon, never in a filled pastel block.
const QUICK = [
  { href: "/servers", key: "quickServers", icon: Server, accent: "text-blue-600" },
  { href: "/request", key: "quickRequest", icon: FileText, accent: "text-teal-600" },
  { href: "/tickets", key: "quickTickets", icon: Ticket, accent: "text-amber-600" },
  { href: "/servers", key: "quickFirewall", icon: Shield, accent: "text-indigo-600" },
] as const;

export default async function DashboardPage() {
  const user = await requireUser();
  const t = await getTranslations("dashboard");
  const tt = await getTranslations("ticket");

  const [bindings, openTickets] = await Promise.all([
    prisma.resourceBinding.findMany({
      where: {
        ticket: { userId: user.id, status: "ACTIVE" },
        resource: { status: "ACTIVE" },
      },
      include: { ticket: true, pveNode: { select: { name: true } } },
      orderBy: { boundAt: "desc" },
      take: 8,
    }),
    prisma.ticket.findMany({
      where: {
        userId: user.id,
        sourceInspection: null,
        status: { in: ["PENDING", "APPROVED", "PROVISIONING", "FAILED"] },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);
  const github = await getGithub();

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          {t("welcome", { name: user.nickname ?? user.realName ?? user.email })}
        </h1>
        <p className="text-sm text-muted-foreground">{t("welcomeSub")}</p>
      </header>

      {github.enabled && github.repoUrl && (
        <section className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("githubProject")}
          </h2>
          <Link
            href={github.repoUrl}
            target="_blank"
            rel="noreferrer"
            className="group flex items-center gap-3 rounded-xl border bg-card p-4 shadow-card transition-all hover:border-brand/40 hover:shadow-card-hover"
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-secondary/60">
              <GitFork className="size-[18px] text-neutral-700" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{github.repoName || github.repoUrl}</div>
              <div className="truncate text-xs text-muted-foreground">
                {github.repoName ? github.repoUrl : t("githubProjectDesc")}
              </div>
            </div>
            <ExternalLink className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-brand" />
          </Link>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("quickAccess")}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK.map(({ href, key, icon: Icon, accent }) => (
            <Link key={key} href={href} className="group">
              <div className="flex h-full items-center gap-3 rounded-xl border bg-card p-4 shadow-card transition-all group-hover:border-brand/40 group-hover:shadow-card-hover">
                <div className="flex size-10 items-center justify-center rounded-lg border bg-secondary/60">
                  <Icon className={`size-[18px] ${accent}`} strokeWidth={1.75} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{t(key)}</div>
                  <div className="truncate text-xs text-muted-foreground">{t(`${key}Desc`)}</div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="shadow-card lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{t("myResources")}</CardTitle>
            <Link
              href="/servers"
              className="flex items-center gap-0.5 text-xs font-medium text-brand hover:text-brand-strong"
            >
              {t("viewAll")} <ArrowRight className="size-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {bindings.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <div className="flex size-11 items-center justify-center rounded-full bg-secondary">
                  <Server className="size-5 text-muted-foreground" strokeWidth={1.75} />
                </div>
                <p className="max-w-xs text-sm text-muted-foreground">{t("noResources")}</p>
              </div>
            ) : (
              <ul className="-mx-2">
                {bindings.map((b) => (
                  <li key={b.id}>
                    <Link
                      href={`/servers/${b.id}`}
                      className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm transition-colors hover:bg-secondary/70"
                    >
                      <span
                        className={`size-2 shrink-0 rounded-full ${
                          b.ticket.status === "ACTIVE"
                            ? "bg-emerald-500 ring-4 ring-emerald-500/15"
                            : "bg-amber-400 ring-4 ring-amber-400/15"
                        }`}
                      />
                      <span className="font-medium">VM {b.vmid}</span>
                      <span className="tnum text-muted-foreground">{b.internalIp}</span>
                      <span className="ml-auto text-xs text-muted-foreground/70">{b.pveNode.name}</span>
                      <ChevronRight className="size-3.5 text-muted-foreground/40" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader>
            <CardTitle>{t("openTickets")}</CardTitle>
          </CardHeader>
          <CardContent>
            {openTickets.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{tt("empty")}</p>
            ) : (
              <ul className="space-y-1">
                {openTickets.map((tk) => (
                  <li key={tk.id}>
                    <Link
                      href={`/tickets/${tk.id}`}
                      className="-mx-2 flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-secondary/70"
                    >
                      <span className="tnum truncate text-muted-foreground">#{tk.id.slice(-8)}</span>
                      <Badge variant="secondary" className={STATUS_BADGE[tk.status]}>
                        {tt(`status.${tk.status}`)}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
