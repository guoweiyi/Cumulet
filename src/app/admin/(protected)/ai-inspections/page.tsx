import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function AiInspectionsPage() {
  await requireAdmin();
  const t = await getTranslations("admin.ai");
  const tc = await getTranslations("common");
  const locale = await getLocale();
  const inspections = await prisma.aiInspectionLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      binding: { select: { vmid: true, pveNode: { select: { name: true } } } },
      requestedBy: { select: { email: true } },
      alertTicket: { select: { id: true, status: true } },
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">{t("title")}</h1>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("resource")}</TableHead>
                <TableHead>{t("trigger")}</TableHead>
                <TableHead>{t("score")}</TableHead>
                <TableHead>{t("severity")}</TableHead>
                <TableHead>{t("summary")}</TableHead>
                <TableHead>{t("alert")}</TableHead>
                <TableHead>{t("time")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inspections.map((inspection) => {
                const analysis = inspection.analysis as { summary?: string } | null;
                return (
                  <TableRow key={inspection.id}>
                    <TableCell className="font-medium">
                      VM {inspection.binding.vmid}
                      <span className="ml-2 text-xs text-muted-foreground">{inspection.binding.pveNode.name}</span>
                    </TableCell>
                    <TableCell>{t(`triggers.${inspection.trigger}`)}</TableCell>
                    <TableCell className="tnum">{inspection.healthScore ?? tc("none")}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{t(`severities.${inspection.severity}`)}</Badge>
                    </TableCell>
                    <TableCell className="max-w-sm truncate text-sm text-muted-foreground">
                      {analysis?.summary ?? (inspection.status === "FAILED" ? t("failed") : tc("none"))}
                    </TableCell>
                    <TableCell>
                      {inspection.alertTicket ? (
                        <Link className="text-blue-700 hover:underline" href={`/admin/tickets/${inspection.alertTicket.id}`}>
                          {t("openAlert")}
                        </Link>
                      ) : tc("none")}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {inspection.createdAt.toLocaleString(locale)}
                    </TableCell>
                  </TableRow>
                );
              })}
              {inspections.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                    {t("empty")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
