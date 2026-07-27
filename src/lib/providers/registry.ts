import "server-only";
import { prisma } from "@/lib/prisma";
import { ProviderError } from "./errors";
import { ProxmoxProvider } from "./proxmox";
import type { IHypervisorProvider } from "./types";

export async function getHypervisorProvider(
  providerId: string,
  actorId?: string | null,
): Promise<IHypervisorProvider> {
  const instance = await prisma.providerInstance.findUnique({
    where: { id: providerId },
    include: { pveNode: true },
  });
  if (!instance) throw new ProviderError("provider_not_found", "Provider instance not found");
  if (instance.status !== "ACTIVE") {
    throw new ProviderError("provider_unavailable", "Provider instance is not active");
  }

  switch (instance.type) {
    case "PROXMOX":
      if (!instance.pveNode) {
        throw new ProviderError("provider_misconfigured", "Proxmox node is not linked");
      }
      return ProxmoxProvider.fromNode(instance.id, instance.pveNode, actorId);
    default:
      throw new ProviderError(
        "provider_not_implemented",
        `Provider type ${instance.type} is not installed`,
      );
  }
}

