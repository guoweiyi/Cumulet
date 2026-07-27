type ResourceOwner = { email: string; nickname?: string | null };

function cleanPart(value: string, fallback: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/[-_]{2,}/g, "-");
  return normalized.replace(/^[-_]+|[-_]+$/g, "") || fallback;
}

/** Stable operator-facing name: requester_resource-name, capped for PVE. */
export function buildResourceName(owner: ResourceOwner, requestedName: string, vmid: number): string {
  const ownerPart = cleanPart(owner.nickname || owner.email.split("@")[0] || "user", "user");
  const resourcePart = cleanPart(requestedName, `vm-${vmid}`);
  const suffixBudget = Math.max(1, 63 - ownerPart.length - 1);
  return `${ownerPart}_${resourcePart.slice(0, suffixBudget)}`;
}
