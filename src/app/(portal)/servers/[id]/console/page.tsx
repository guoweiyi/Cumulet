import { requireBindingAccess } from "@/lib/guards";
import { VncConsole } from "@/components/vm/vnc-console";

export default async function ConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { binding } = await requireBindingAccess(id, { write: true });
  return <VncConsole bindingId={binding.id} vmid={binding.vmid} />;
}
