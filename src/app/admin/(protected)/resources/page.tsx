import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guards";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { STATUS_BADGE } from "@/components/ticket-status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function AdminResourcesPage() {
  await requireAdmin();
  const t = await getTranslations("admin.nav");
  const tt = await getTranslations("ticket");
  const tv = await getTranslations("vm");
  const tr = await getTranslations("admin.resource");

  const bindings = await prisma.resourceBinding.findMany({
    orderBy: { boundAt: "desc" },
    include: {
      pveNode: { select: { name: true } },
      ticket: { select: { id: true, status: true, user: { select: { email: true, realName: true } } } },
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">{t("resources")}</h1>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>VMID</TableHead>
                <TableHead>{tv("internalIp")}</TableHead>
                <TableHead>{tv("az")}</TableHead>
                <TableHead>{tt("status.ACTIVE")}</TableHead>
                <TableHead>{tr("user")}</TableHead>
                <TableHead>{tr("bastion")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bindings.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <Link href={`/admin/tickets/${b.ticket.id}`} className="font-medium text-blue-700 hover:underline">
                      {b.vmid}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{b.internalIp}</TableCell>
                  <TableCell>{b.pveNode.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={STATUS_BADGE[b.ticket.status]}>
                      {tt(`status.${b.ticket.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {b.ticket.user.realName ?? b.ticket.user.email}
                  </TableCell>
                  <TableCell>
                    {b.jsPermissionId ? (
                      <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">
                        ✓
                      </Badge>
                    ) : (
                      <span className="text-xs text-neutral-400">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {bindings.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-neutral-400">
                    {tr("empty")}
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
