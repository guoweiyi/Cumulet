import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/guards";
import { getAgreement } from "@/lib/settings";
import type { FormDefinition } from "@/lib/form-engine";
import { RequestForm } from "@/components/forms/request-form";

export default async function RequestPage() {
  await requireUser();
  const t = await getTranslations("ticket");
  const agreement = await getAgreement();

  const schema = await prisma.formSchema.findFirst({
    where: { status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
  });

  if (!schema) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">{t("requestFormMissing")}</div>
    );
  }

  return (
    <RequestForm schemaId={schema.id} definition={schema.definition as unknown as FormDefinition} agreement={agreement} />
  );
}
