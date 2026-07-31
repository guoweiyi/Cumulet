import "server-only";
import { prisma } from "./prisma";
import { getSetting } from "./settings";
import { jumpServerLunaUrl, jumpServerUserAssetPath } from "./jumpserver";
import { DETAIL_MODULES, parseWorkflowDefinition, type DetailModule } from "./workflow-definition";

export async function loadResourcePanel(bindingId: string) {
  const binding = await prisma.resourceBinding.findUnique({
    where: { id: bindingId },
    include: {
      pveNode: { select: { name: true } },
      resource: { select: { displayName: true } },
      ticket: { select: { status: true, user: { select: { email: true, nickname: true, realName: true } } } },
      workflowSchema: { select: { definition: true } },
    },
  });
  if (!binding) return null;
  const definition = binding.workflowSchema ? parseWorkflowDefinition(binding.workflowSchema.definition) : null;
  const jumpserver = await getSetting("jumpserver");
  const owner = binding.ticket.user;

  // Logs are no longer shown on the server detail page. Filter them at render
  // time so existing workflow definitions keep parsing, without a migration.
  const detailModules = (definition?.detailModules ?? [...DETAIL_MODULES]).filter(
    (module) => module !== "logs",
  );

  return {
    binding: {
      id: binding.id,
      vmid: binding.vmid,
      internalIp: binding.internalIp,
      ciUser: binding.cloudInitUser,
      nodeName: binding.pveNode.name,
      ticketStatus: binding.ticket.status,
      jsAssetId: binding.jsAssetId,
      jsAssetName: binding.resource.displayName,
      jsAssetPath: jumpServerUserAssetPath(owner.realName ?? owner.nickname ?? owner.email),
    },
    jsPortalUrl: jumpserver?.baseUrl ? jumpServerLunaUrl(jumpserver.baseUrl) : null,
    detailModules: detailModules as DetailModule[],
  };
}
