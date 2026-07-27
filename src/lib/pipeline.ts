import "server-only";
import type {
  PveNode,
  ResourceBinding,
  ProvisioningStepType,
  ProvisionedResource,
} from "@prisma/client";
import { prisma } from "./prisma";
import { pveClient, PveClient } from "./pve";
import { jumpServerClient, JumpServerError } from "./jumpserver";
import { getSetting } from "./settings";
import { audit } from "./audit";
import { addSystemMessage } from "./tickets";
import { encryptSecret, hashToken, randomToken } from "./crypto";
import { generateVmPassword } from "./vm";
import { BASELINE_MARK, type BaselineRule } from "./firewall";
import { emailProvisioned, emailStepFailedToAdmins } from "./emails";
import { getHypervisorProvider, type IHypervisorProvider } from "./providers";
import { emitResourceProvisioned, emitTicketStatusChanged } from "./webhooks";
import { provisionExternalAccess, type ExternalAccessRequest } from "./networking";

/**
 * Step-tracked, resumable, idempotent provisioning pipeline. Synchronous
 * execution (no queues); each step persists a ProvisioningStep row and can be
 * retried or skipped individually. Steps check-before-create so re-runs are
 * safe.
 */

export const STEP_ORDER: ProvisioningStepType[] = [
  "VALIDATE_VMID",
  "CLOUD_INIT",
  "PVE_SECURITY_GROUP",
  "EXTERNAL_ACCESS",
  "JS_ASSET",
  "JS_PERMISSION",
  "NOTIFY",
];

type BindingFull = ResourceBinding & { pveNode: PveNode; resource: ProvisionedResource };

type StepContext = {
  binding: BindingFull;
  pve: PveClient;
  provider: IHypervisorProvider;
  actorId: string;
  /** Cloud-init password generated this run — kept in-memory only for NOTIFY. */
  runState: { ciPassword?: string; assetName: string };
};

async function loadBinding(bindingId: string): Promise<BindingFull> {
  const binding = await prisma.resourceBinding.findUnique({
    where: { id: bindingId },
    include: { pveNode: true, resource: true },
  });
  if (!binding) throw new Error("binding_not_found");
  return binding;
}

async function markStep(
  bindingId: string,
  step: ProvisioningStepType,
  status: "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED",
  errorMessage?: string | null,
) {
  const now = new Date();
  await prisma.provisioningStep.upsert({
    where: { bindingId_step: { bindingId, step } },
    create: {
      bindingId,
      step,
      status,
      errorMessage: errorMessage ?? null,
      attempts: status === "RUNNING" ? 1 : 0,
      startedAt: status === "RUNNING" ? now : undefined,
      finishedAt: status === "SUCCESS" || status === "FAILED" || status === "SKIPPED" ? now : undefined,
    },
    update: {
      status,
      errorMessage: errorMessage ?? null,
      ...(status === "RUNNING" ? { startedAt: now, attempts: { increment: 1 } } : {}),
      ...(status !== "RUNNING" ? { finishedAt: now } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Individual steps (each idempotent)
// ---------------------------------------------------------------------------

const STEP_IMPL: Record<ProvisioningStepType, (ctx: StepContext) => Promise<void>> = {
  async VALIDATE_VMID({ binding, provider }) {
    // Throws if the VM does not exist on the node.
    await provider.getStatus({ providerResourceId: binding.resource.providerResourceId });
  },

  async CLOUD_INIT({ binding, provider, runState }) {
    const password = generateVmPassword();
    runState.ciPassword = password;
    // ipconfig / nameserver come from admin-provided values captured at approve.
    const meta = (binding.provisionMeta as Record<string, string> | null) ?? {};
    await provider.provision({
      providerResourceId: binding.resource.providerResourceId,
      displayName: binding.resource.displayName,
      cpuCores: binding.resource.cpuCores,
      ramGB: binding.resource.ramGB,
      diskGB: binding.resource.diskGB,
      cloudInit: {
        username: binding.cloudInitUser,
        password,
        sshKeys: meta.sshKeys,
        ipConfig: meta.ipconfig,
        nameserver: meta.nameserver,
      },
    });
    await prisma.resourceBinding.update({
      where: { id: binding.id },
      data: { initialPasswordDeliveredAt: null },
    });
  },

  async PVE_SECURITY_GROUP({ binding, pve, actorId }) {
    const groupName = binding.pveSecurityGroup;
    if (!groupName) throw new Error("no_security_group_selected");

    // Ensure group exists on this node (idempotent).
    const groups = await pve.listGroups();
    if (!groups.some((g) => g.group === groupName)) {
      await pve.createGroup(groupName);
    }
    // Attach to VM if not already attached.
    const rules = await pve.listVmRules(binding.vmid);
    if (!rules.some((r) => r.type === "group" && r.action === groupName)) {
      await pve.addVmRule(binding.vmid, { type: "group", action: groupName });
    }
    // Enable VM firewall.
    await pve.setVmFirewallOptions(binding.vmid, { enable: 1 });

    // Baseline: allow JumpServer host → :22. Recorded + written idempotently.
    const provisioning = await getSetting("provisioning");
    const jsIp = provisioning?.jumpServerInternalIp;
    if (jsIp) {
      const baseline: BaselineRule[] = [
        {
          direction: "in",
          action: "ACCEPT",
          proto: "tcp",
          dport: "22",
          source: jsIp,
          comment: "JumpServer SSH",
        },
      ];
      const current = await pve.listVmRules(binding.vmid);
      const exists = current.some(
        (r) =>
          r.type === "in" &&
          r.action === "ACCEPT" &&
          r.dport === "22" &&
          r.source === jsIp,
      );
      if (!exists) {
        await pve.addVmRule(binding.vmid, {
          type: "in",
          action: "ACCEPT",
          proto: "tcp",
          dport: "22",
          source: jsIp,
          enable: 1,
          comment: `${BASELINE_MARK} JumpServer SSH`,
          pos: 0,
        });
      }
      await prisma.vmFirewallBaseline.upsert({
        where: { bindingId: binding.id },
        create: { bindingId: binding.id, rules: baseline, updatedById: actorId },
        update: { rules: baseline, updatedById: actorId },
      });
    }
  },

  async EXTERNAL_ACCESS({ binding, actorId }) {
    const meta = (binding.provisionMeta as {
      externalAccess?: Omit<ExternalAccessRequest, "resourceId" | "automationKey">;
    } | null) ?? {};
    if (!meta.externalAccess) return;
    await provisionExternalAccess(
      {
        ...meta.externalAccess,
        resourceId: binding.resourceId,
        automationKey: `pipeline:${binding.id}`,
      },
      actorId,
    );
  },

  async JS_ASSET({ binding, runState }) {
    const js = await jumpServerClient(binding.boundById);
    const settings = await getSetting("jumpserver");
    const name = runState.assetName;

    // Idempotent: reuse an existing asset with the same address.
    let assetId = binding.jsAssetId;
    if (!assetId) {
      const existing = await js.findHostByAddress(binding.internalIp);
      assetId = existing?.id ?? null;
    }
    if (!assetId) {
      const host = await js.createHost({
        name,
        address: binding.internalIp,
        nodeId: settings?.assetNodeId ?? "",
        accountTemplate: settings?.defaultAccountUsername ? undefined : undefined,
      });
      assetId = host.id;
    }
    await prisma.resourceBinding.update({
      where: { id: binding.id },
      data: { jsAssetId: assetId },
    });
  },

  async JS_PERMISSION({ binding }) {
    const js = await jumpServerClient(binding.boundById);
    const settings = await getSetting("jumpserver");
    const ticket = await prisma.ticket.findUnique({
      where: { id: binding.ticketId },
      include: { user: true },
    });
    if (!ticket) throw new Error("ticket_missing");
    if (!binding.jsAssetId) throw new Error("asset_not_created");

    // Match the requester in JumpServer by email.
    let jsUser = await js.findUserByEmail(ticket.user.email);
    if (!jsUser) {
      if (settings?.autoCreateUsers) {
        const created = await js.createUser(
          ticket.user.email,
          ticket.user.realName ?? ticket.user.nickname ?? ticket.user.email,
        );
        jsUser = { id: created.id, name: ticket.user.email };
      } else {
        throw new JumpServerError(
          404,
          `Requester ${ticket.user.email} not found in JumpServer. Invite the user, or enable auto-create in Settings, then retry.`,
        );
      }
    }

    let permId = binding.jsPermissionId;
    if (!permId) {
      const perm = await js.createAssetPermission({
        name: `cumulet-${binding.vmid}-${ticket.user.email}`,
        userId: jsUser.id,
        assetId: binding.jsAssetId,
        accountUsername: settings?.defaultAccountUsername ?? "@ALL",
      });
      permId = perm.id;
    }
    await prisma.resourceBinding.update({
      where: { id: binding.id },
      data: { jsPermissionId: permId },
    });
  },

  async NOTIFY({ binding, runState }) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: binding.ticketId },
      include: { user: true },
    });
    if (!ticket) throw new Error("ticket_missing");
    const provisioning = await getSetting("provisioning");

    // One-time credential link (only when a fresh password exists this run).
    let credentialUrl = `${(process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "")}/servers/${binding.id}`;
    if (runState.ciPassword) {
      const token = randomToken(32);
      await prisma.oneTimeCredential.create({
        data: {
          tokenHash: hashToken(token),
          bindingId: binding.id,
          payloadEnc: encryptSecret(
            JSON.stringify({
              user: binding.cloudInitUser,
              password: runState.ciPassword,
              ip: binding.internalIp,
              jsPortalUrl: provisioning?.portalUrl ?? "",
            }),
          ),
          expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        },
      });
      credentialUrl = `${(process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "")}/credentials/${token}`;
      await prisma.resourceBinding.update({
        where: { id: binding.id },
        data: { initialPasswordDeliveredAt: new Date() },
      });
    }

    await emailProvisioned(ticket.user.id, ticket.user.email, {
      ticketId: ticket.id,
      credentialUrl,
      jsPortalUrl: provisioning?.portalUrl ?? "",
      assetName: runState.assetName,
    });
  },
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runStep(
  ctx: StepContext,
  step: ProvisioningStepType,
): Promise<boolean> {
  await markStep(ctx.binding.id, step, "RUNNING");
  try {
    await STEP_IMPL[step](ctx);
    await markStep(ctx.binding.id, step, "SUCCESS");
    await audit({
      actorId: ctx.actorId,
      action: `pipeline.step.success`,
      targetType: "ResourceBinding",
      targetId: ctx.binding.id,
      metadata: { step },
    });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "step failed";
    await markStep(ctx.binding.id, step, "FAILED", message);
    await audit({
      actorId: ctx.actorId,
      action: `pipeline.step.failed`,
      targetType: "ResourceBinding",
      targetId: ctx.binding.id,
      metadata: { step, error: message },
    });
    const ticket = await prisma.ticket.findUnique({ where: { id: ctx.binding.ticketId } });
    if (ticket) void emailStepFailedToAdmins(ticket.id, step, message);
    return false;
  }
}

async function makeContext(binding: BindingFull, actorId: string): Promise<StepContext> {
  return {
    binding,
    pve: pveClient(binding.pveNode, actorId),
    provider: await getHypervisorProvider(binding.resource.providerId, actorId),
    actorId,
    runState: { assetName: `cumulet-${binding.vmid}` },
  };
}

/** Recompute ticket status from the full set of steps. */
async function reconcileTicketStatus(bindingId: string, ticketId: string): Promise<void> {
  const steps = await prisma.provisioningStep.findMany({ where: { bindingId } });
  const byStep = new Map(steps.map((s) => [s.step, s.status]));
  const allDone = STEP_ORDER.every(
    (s) => byStep.get(s) === "SUCCESS" || byStep.get(s) === "SKIPPED",
  );
  if (allDone) {
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (ticket && ticket.status === "PROVISIONING") {
      await prisma.$transaction([
        prisma.ticket.update({ where: { id: ticketId }, data: { status: "ACTIVE" } }),
        prisma.provisionedResource.update({
          where: { ticketId },
          data: { status: "ACTIVE" },
        }),
      ]);
      await addSystemMessage(ticketId, "provisioned");
      const resource = await prisma.provisionedResource.findUnique({ where: { ticketId } });
      if (resource) {
        await emitTicketStatusChanged({
          ticketId,
          userId: resource.ownerId,
          previousStatus: "PROVISIONING",
          status: "ACTIVE",
        });
        await emitResourceProvisioned({
          resourceId: resource.id,
          ticketId,
          ownerId: resource.ownerId,
          providerId: resource.providerId,
          providerResourceId: resource.providerResourceId,
        });
      }
    }
  }
}

/** Run the whole pipeline in order, stopping at the first failure. */
export async function runPipeline(bindingId: string, actorId: string): Promise<void> {
  const binding = await loadBinding(bindingId);
  const ctx = await makeContext(binding, actorId);
  for (const step of STEP_ORDER) {
    const existing = await prisma.provisioningStep.findUnique({
      where: { bindingId_step: { bindingId, step } },
    });
    if (existing?.status === "SUCCESS" || existing?.status === "SKIPPED") continue;
    const ok = await runStep(ctx, step);
    if (!ok) {
      const ticket = await prisma.ticket.findUnique({ where: { id: binding.ticketId } });
      if (ticket && ticket.status === "PROVISIONING") await addSystemMessage(ticket.id, "provisionFailed");
      return;
    }
  }
  await reconcileTicketStatus(bindingId, binding.ticketId);
}

/** Retry one step (and continue the remaining steps if it succeeds). */
export async function retryStep(
  bindingId: string,
  step: ProvisioningStepType,
  actorId: string,
): Promise<void> {
  const binding = await loadBinding(bindingId);
  const ctx = await makeContext(binding, actorId);
  const ok = await runStep(ctx, step);
  if (!ok) return;
  // Continue with subsequent not-yet-successful steps.
  const idx = STEP_ORDER.indexOf(step);
  for (const next of STEP_ORDER.slice(idx + 1)) {
    const existing = await prisma.provisioningStep.findUnique({
      where: { bindingId_step: { bindingId, step: next } },
    });
    if (existing?.status === "SUCCESS" || existing?.status === "SKIPPED") continue;
    const cont = await runStep(ctx, next);
    if (!cont) return;
  }
  await reconcileTicketStatus(bindingId, binding.ticketId);
}

/** Deliberately skip a step (recorded + audited). */
export async function skipStep(
  bindingId: string,
  step: ProvisioningStepType,
  actorId: string,
): Promise<void> {
  const binding = await loadBinding(bindingId);
  await markStep(bindingId, step, "SKIPPED");
  await audit({
    actorId,
    action: "pipeline.step.skipped",
    targetType: "ResourceBinding",
    targetId: bindingId,
    metadata: { step },
  });
  await reconcileTicketStatus(bindingId, binding.ticketId);
}
