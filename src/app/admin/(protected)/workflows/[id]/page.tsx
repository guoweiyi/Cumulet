import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guards";
import { parseWorkflowDefinition } from "@/lib/workflow-definition";
import { WorkflowBuilder } from "@/components/workflows/workflow-builder";
import type { FormDefinition } from "@/lib/form-engine";

export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin();
  const { id } = await params;
  const [schema, forms] = await Promise.all([
    prisma.workflowSchema.findUnique({ where: { id } }),
    prisma.formSchema.findMany({ where: { status: "PUBLISHED" }, select: { definition: true } }),
  ]);
  if (!schema) notFound();
  const definition = parseWorkflowDefinition(schema.definition);
  if (!definition) notFound();
  const requestVariableKeys = [...new Set(forms.flatMap((form) => (form.definition as unknown as FormDefinition).fields?.map((field) => field.id) ?? []))];
  return <WorkflowBuilder schemaId={id} initialDefinition={definition} requestVariableKeys={requestVariableKeys} editable={(user.role === "ADMIN" || user.role === "SUPER_ADMIN") && schema.status === "DRAFT"} version={schema.version} status={schema.status} />;
}
