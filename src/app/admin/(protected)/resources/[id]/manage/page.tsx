import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/guards";
import { loadResourcePanel } from "@/lib/resource-panel";
import { VmPanel } from "@/components/vm/vm-panel";

export default async function AdminResourceManagePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const panel = await loadResourcePanel(id);
  if (!panel) notFound();
  return <VmPanel {...panel} />;
}
