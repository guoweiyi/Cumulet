import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/guards";
import { parseWorkflowDefinition } from "@/lib/workflow-definition";
import { WorkflowBuilder } from "@/components/workflows/workflow-builder";

export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin();
  const { id } = await params;
  const schema = await prisma.workflowSchema.findUnique({ where: { id } });
  if (!schema) notFound();
  const definition = parseWorkflowDefinition(schema.definition);
  if (!definition) notFound();
  return <WorkflowBuilder schemaId={id} initialDefinition={definition} editable={(user.role === "ADMIN" || user.role === "SUPER_ADMIN") && schema.status === "DRAFT"} version={schema.version} status={schema.status} />;
}
