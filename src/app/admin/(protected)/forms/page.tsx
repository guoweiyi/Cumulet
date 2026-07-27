import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guards";
import { localized, type I18nText } from "@/i18n/config";
import type { FormDefinition } from "@/lib/form-engine";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { NewFormButton, ImportButton, FormRowActions } from "@/components/forms/form-list-actions";

export default async function AdminFormsPage() {
  const user = await requireAdmin();
  const t = await getTranslations("admin.form");
  const locale = await getLocale();

  const schemas = await prisma.formSchema.findMany({
    orderBy: [{ familyKey: "asc" }, { version: "desc" }],
    include: { _count: { select: { tickets: true } } },
  });

  const families = new Map<string, typeof schemas>();
  for (const s of schemas) families.set(s.familyKey, [...(families.get(s.familyKey) ?? []), s]);
  const canWrite = user.role === "ADMIN" || user.role === "SUPER_ADMIN";

  const STATUS_TINT: Record<string, string> = {
    DRAFT: "bg-amber-50 text-amber-700",
    PUBLISHED: "bg-emerald-50 text-emerald-700",
    ARCHIVED: "bg-neutral-100 text-neutral-500",
  };
  const nameOf = (s: (typeof schemas)[number]) =>
    (s.definition as unknown as FormDefinition).meta?.name ?? ({ zh: "" } as I18nText);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        {canWrite && (
          <div className="flex gap-2">
            <ImportButton />
            <NewFormButton />
          </div>
        )}
      </div>
      {[...families.entries()].map(([familyKey, versions]) => (
        <Card key={familyKey} className="shadow-card">
          <CardContent className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="font-medium">{localized(nameOf(versions[0]), locale)}</span>
              <code className="text-[10px] text-muted-foreground/60">{familyKey}</code>
              <div className="ml-auto">
                <FormRowActions
                  latestId={versions[0].id}
                  canWrite={canWrite}
                  hasDraft={versions.some((v) => v.status === "DRAFT")}
                />
              </div>
            </div>
            <ul className="divide-y">
              {versions.map((v) => (
                <li key={v.id}>
                  <Link
                    href={`/admin/forms/${v.id}`}
                    className="flex items-center gap-3 py-2 text-sm hover:bg-secondary/60"
                  >
                    <span>{t("version", { n: v.version })}</span>
                    <Badge variant="secondary" className={STATUS_TINT[v.status]}>
                      {t(`statusLabel.${v.status}` as never)}
                    </Badge>
                    <span className="tnum text-xs text-muted-foreground/70">
                      {(v.definition as unknown as FormDefinition).fields?.length ?? 0} fields · {v._count.tickets} tickets
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground/60">
                      {v.updatedAt.toISOString().slice(0, 10)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
      {families.size === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">{t("newForm")}</p>
      )}
    </div>
  );
}
