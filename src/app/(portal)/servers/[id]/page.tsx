import { notFound } from "next/navigation";
import { requireBindingAccess } from "@/lib/guards";
import { loadResourcePanel } from "@/lib/resource-panel";
import { VmPanel } from "@/components/vm/vm-panel";

export default async function ServerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireBindingAccess(id);
  const panel = await loadResourcePanel(id);
  if (!panel) notFound();
  return <VmPanel {...panel} />;
}
