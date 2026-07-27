import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/guards";
import { getSetting } from "@/lib/settings";
import { VmPanel } from "@/components/vm/vm-panel";

export default async function ServerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  // Strict ownership at the page level (admins use /admin/resources instead).
  const binding = await prisma.resourceBinding.findFirst({
    where: { id, ticket: { userId: user.id } },
    include: {
      pveNode: { select: { name: true } },
      ticket: { select: { status: true, id: true } },
    },
  });
  if (!binding) notFound();

  const provisioning = await getSetting("provisioning");

  return (
    <VmPanel
      binding={{
        id: binding.id,
        vmid: binding.vmid,
        internalIp: binding.internalIp,
        ciUser: binding.cloudInitUser,
        nodeName: binding.pveNode.name,
        ticketStatus: binding.ticket.status,
        jsAssetId: binding.jsAssetId,
      }}
      jsPortalUrl={provisioning?.portalUrl ?? null}
    />
  );
}
