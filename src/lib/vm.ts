import type { PveNode, ResourceBinding } from "@prisma/client";
import { randomInt } from "node:crypto";
import { ApiError } from "./api";
import { requireBindingAccess } from "./guards";
import { pveClient, PveClient, PveError } from "./pve";
import { getHypervisorProvider, ProviderError, type IHypervisorProvider } from "./providers";

export type VmContext = {
  binding: ResourceBinding & {
    pveNode: PveNode;
    ticket: { id: string; userId: string; status: string };
    resource: { providerId: string; providerResourceId: string; status: string };
  };
  client: PveClient;
  provider: IHypervisorProvider;
  userId: string;
  owner: boolean;
};

/**
 * Resolve a binding the caller may act on and a PVE client for its node.
 * `write` additionally requires the resource to be ACTIVE (users cannot act
 * on half-provisioned or closed resources).
 */
export async function vmContext(bindingId: string, opts?: { write?: boolean }): Promise<VmContext> {
  // Forward the write flag so AUDITOR (read-only admin role) is rejected with
  // 403 on any mutating VM operation — not just 404'd on foreign bindings.
  const { user, binding, owner } = await requireBindingAccess(bindingId, { write: opts?.write });
  if (opts?.write) {
    const admin = !owner;
    if (
      !admin &&
      (binding.ticket.status !== "ACTIVE" || binding.resource.status !== "ACTIVE")
    ) {
      throw new ApiError(409, "resource_not_active");
    }
  }
  return {
    binding: binding as VmContext["binding"],
    client: pveClient(binding.pveNode, user.id),
    provider: await getHypervisorProvider(
      binding.resource.providerId,
      user.id,
      { allowInactive: !opts?.write },
    ),
    userId: user.id,
    owner,
  };
}

/** Convert PveError to a friendly 502 ApiError (never leak token/URL details). */
export function mapPveError(err: unknown): never {
  if (err instanceof PveError) {
    const code = err.status === 403 ? "pve_permission_denied" : "pve_error";
    throw new ApiError(502, code, err.message);
  }
  if (err instanceof ApiError) throw err;
  throw err;
}

export function mapProviderError(err: unknown): never {
  if (err instanceof ProviderError) {
    const status = err.code === "disk_shrink_forbidden" ? 409 : 502;
    throw new ApiError(status, err.code);
  }
  if (err instanceof ApiError) throw err;
  throw err;
}

const BOOT_DISK_KEYS = ["scsi0", "virtio0", "sata0", "ide0"] as const;

/** Locate the primary disk and its size in GB from a VM config. */
export function findBootDisk(config: Record<string, string | number>): { key: string; sizeGb: number } | null {
  for (const key of BOOT_DISK_KEYS) {
    const raw = config[key];
    if (typeof raw === "string" && !raw.startsWith("none")) {
      const m = raw.match(/size=(\d+(?:\.\d+)?)([MGT])/);
      if (m) {
        const n = parseFloat(m[1]);
        const gb = m[2] === "T" ? n * 1024 : m[2] === "M" ? n / 1024 : n;
        return { key, sizeGb: Math.round(gb) };
      }
      return { key, sizeGb: 0 };
    }
  }
  return null;
}

/** Random Cloud-Init password: 16 chars, unambiguous alphabet. */
export function generateVmPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 16; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}
