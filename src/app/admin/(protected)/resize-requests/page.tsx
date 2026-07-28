import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ResizeRequestActions } from "@/components/admin/resize-request-actions";

export default async function ResizeRequestsPage() {
  await requireAdmin();
  const t = await getTranslations("admin.resize");
  const requests = await prisma.resourceResizeRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      requestedBy: { select: { email: true, realName: true } },
      decidedBy: { select: { email: true } },
      resource: { select: { displayName: true, providerResourceId: true } },
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      {requests.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">{t("empty")}</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {requests.map((request) => (
            <Card key={request.id}>
              <CardContent className="grid gap-4 p-4 md:grid-cols-[1fr_auto] md:items-center">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{request.resource.displayName}</span>
                    <span className="font-mono text-xs text-muted-foreground">VM {request.resource.providerResourceId}</span>
                    <Badge variant="secondary">{t(`status.${request.status}`)}</Badge>
                  </div>
                  <p className="text-sm">
                    CPU {request.beforeCpuCores} → {request.requestedCpuCores} ·
                    {" "}RAM {request.beforeRamGB} → {request.requestedRamGB} GB ·
                    {" "}Disk {request.beforeDiskGB} → {request.requestedDiskGB} GB
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {request.requestedBy.realName ?? request.requestedBy.email} · {request.createdAt.toLocaleString("zh-CN")}
                    {request.reason ? ` · ${request.reason}` : ""}
                  </p>
                  {request.errorMessage && <p className="text-xs text-red-600">{request.errorMessage}</p>}
                </div>
                {request.status === "PENDING" && <ResizeRequestActions id={request.id} />}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
