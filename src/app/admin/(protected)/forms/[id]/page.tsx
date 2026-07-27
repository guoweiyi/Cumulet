import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guards";
import type { FormDefinition } from "@/lib/form-engine";
import { FormBuilder } from "@/components/forms/form-builder";

export default async function FormBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin();
  const { id } = await params;
  const schema = await prisma.formSchema.findUnique({ where: { id } });
  if (!schema) notFound();

  const canWrite = user.role === "ADMIN" || user.role === "SUPER_ADMIN";
  return (
    <FormBuilder
      schemaId={schema.id}
      initialDefinition={schema.definition as unknown as FormDefinition}
      editable={canWrite && schema.status === "DRAFT"}
      version={schema.version}
      status={schema.status}
    />
  );
}
