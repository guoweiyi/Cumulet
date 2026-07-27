import { api, json, notFound } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireAdminWrite } from "@/lib/guards";
import { pveClient, PveError } from "@/lib/pve";

type Ctx = { params: Promise<{ id: string }> };

/** Test authentication plus the read permissions needed by provisioning. */
export const POST = api<Ctx>(async (_req, ctx) => {
  const user = await requireAdminWrite();
  const { id } = await ctx.params;
  const node = await prisma.pveNode.findUnique({ where: { id } });
  if (!node) throw notFound();

  try {
    const client = pveClient(node, user.id);
    const version = await client.version();
    const checks = {
      vmAudit: { ok: true, message: "" },
      firewallAudit: { ok: true, message: "" },
    };
    try {
      await client.listNodeVms();
    } catch (error) {
      checks.vmAudit = {
        ok: false,
        message: error instanceof PveError ? error.message : "VM inventory check failed",
      };
    }
    try {
      await client.listGroups();
    } catch (error) {
      checks.firewallAudit = {
        ok: false,
        message: error instanceof PveError ? error.message : "Firewall check failed",
      };
    }
    const computeReady = checks.vmAudit.ok;
    await prisma.pveNode.update({
      where: { id },
      data: {
        verified: computeReady,
        verifiedAt: computeReady ? new Date() : null,
        ...(node.providerInstanceId
          ? { providerInstance: { update: { status: computeReady ? "ACTIVE" : "ERROR", verifiedAt: computeReady ? new Date() : null } } }
          : {}),
      },
    });
    return json({
      ok: computeReady,
      version: version.version,
      checks,
      requiredPrivileges: {
        base: ["VM.Audit", "VM.Config.CPU", "VM.Config.Memory", "VM.Config.Disk", "VM.Config.Cloudinit", "VM.PowerMgmt"],
        guestAgentIp: ["VM.Monitor"],
        securityGroups: ["Sys.Audit", "Sys.Modify", "VM.Config.Network"],
      },
    }, computeReady ? 200 : 409);
  } catch (err) {
    await prisma.pveNode.update({
      where: { id },
      data: {
        verified: false,
        ...(node.providerInstanceId
          ? { providerInstance: { update: { status: "ERROR" } } }
          : {}),
      },
    });
    const message = err instanceof PveError ? err.message : "Connection failed";
    return json({ ok: false, message }, 502);
  }
});
