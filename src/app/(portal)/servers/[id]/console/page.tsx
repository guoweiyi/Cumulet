import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/guards";
import { VncConsole } from "@/components/vm/vnc-console";

export default async function ConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const binding = await prisma.resourceBinding.findFirst({
    where: { id, ticket: { userId: user.id } },
    select: { id: true, vmid: true },
  });
  if (!binding) notFound();
  return <VncConsole bindingId={binding.id} vmid={binding.vmid} />;
}
