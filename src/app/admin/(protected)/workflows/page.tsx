import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guards";
import { localized } from "@/i18n/config";
import { parseWorkflowDefinition } from "@/lib/workflow-definition";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { NewWorkflowButton, WorkflowActions } from "@/components/workflows/workflow-actions";

export default async function WorkflowsPage() {
  const user = await requireAdmin();
  const t = await getTranslations("admin.workflow");
  const locale = await getLocale();
  const [schemas, assignments] = await Promise.all([
    prisma.workflowSchema.findMany({ orderBy: [{ familyKey: "asc" }, { version: "desc" }], include: { _count: { select: { bindings: true, resourceBindings: true } } } }),
    prisma.resourceWorkflowBinding.findMany(),
  ]);
  const activeIds = new Set(assignments.map((assignment) => assignment.workflowSchemaId));
  const families = new Map<string, typeof schemas>();
  for (const schema of schemas) families.set(schema.familyKey, [...(families.get(schema.familyKey) ?? []), schema]);
  const canWrite = user.role === "ADMIN" || user.role === "SUPER_ADMIN";

  return <div className="space-y-4">
    <div className="flex items-center justify-between"><h1 className="text-lg font-semibold">{t("title")}</h1>{canWrite && <NewWorkflowButton />}</div>
    {[...families.entries()].map(([familyKey, versions]) => {
      const newestDefinition = parseWorkflowDefinition(versions[0].definition);
      return <Card key={familyKey}><CardContent className="p-4">
        <div className="mb-2 flex items-center gap-2"><span className="font-medium">{newestDefinition ? localized(newestDefinition.meta.name, locale) : familyKey}</span><code className="text-[10px] text-muted-foreground">{newestDefinition?.meta.resourceType}</code></div>
        <div className="divide-y">{versions.map((version) => {
          const definition = parseWorkflowDefinition(version.definition);
          const active = activeIds.has(version.id);
          return <div key={version.id} className="flex items-center gap-3 py-2">
            <Link className="flex min-w-0 flex-1 items-center gap-3 text-sm hover:text-blue-700" href={`/admin/workflows/${version.id}`}>
              <span>v{version.version}</span><Badge variant="secondary">{version.status}</Badge>{active && <Badge className="bg-emerald-50 text-emerald-700">{t("active")}</Badge>}<span className="truncate text-xs text-muted-foreground">{definition?.steps.length ?? 0} {t("steps")} · {version._count.bindings} {t("resources")}</span>
            </Link>
            <WorkflowActions id={version.id} status={version.status} active={active} canWrite={canWrite} hasDraft={versions.some((item) => item.status === "DRAFT")} deletable={version.status === "DRAFT" && version._count.bindings === 0 && version._count.resourceBindings === 0} />
          </div>;
        })}</div>
      </CardContent></Card>;
    })}
    {families.size === 0 && <p className="py-12 text-center text-sm text-muted-foreground">{t("empty")}</p>}
  </div>;
}
