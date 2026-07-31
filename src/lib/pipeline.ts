import "server-only";
import type {
  PveNode,
  ResourceBinding,
  ProvisioningStepType,
  ProvisionedResource,
  WorkflowSchema,
} from "@prisma/client";
import { prisma } from "./prisma";
import { pveClient, PveClient } from "./pve";
import { jumpServerClient, jumpServerLunaUrl, JumpServerError } from "./jumpserver";
import { getSetting } from "./settings";
import { audit } from "./audit";
import { addSystemMessage } from "./tickets";
import { decryptSecret, encryptSecret, hashToken, randomToken } from "./crypto";
import { BASELINE_MARK, type BaselineRule } from "./firewall";
import { emailProvisioned, emailStepFailedToAdmins } from "./emails";
import { getHypervisorProvider, type IHypervisorProvider } from "./providers";
import { emitResourceProvisioned, emitTicketStatusChanged } from "./webhooks";
import { provisionExternalAccess, type ExternalAccessRequest } from "./networking";
import { parseWorkflowDefinition, type HttpRequestConfig, type StepConfig, type WorkflowDefinition } from "./workflow-definition";
import { fetch as ufetch } from "undici";
import { safeDispatcher } from "./safe-url";

/**
 * Step-tracked, resumable, idempotent provisioning pipeline. Synchronous
 * execution (no queues); each step persists a ProvisioningStep row and can be
 * retried or skipped individually. Steps check-before-create so re-runs are
 * safe.
 */

export const STEP_ORDER: ProvisioningStepType[] = [
  "VALIDATE_VMID",
  "CLOUD_INIT",
  "DATABASE_BOOTSTRAP",
  "PVE_SECURITY_GROUP",
  "EXTERNAL_ACCESS",
  "JS_ASSET",
  "JS_PERMISSION",
  "NOTIFY",
];

type BindingFull = ResourceBinding & { pveNode: PveNode; resource: ProvisionedResource; workflowSchema: WorkflowSchema | null };

type StepContext = {
  binding: BindingFull;
  pve: PveClient;
  provider: IHypervisorProvider;
  actorId: string;
  /** Decrypted only for the active run; the database stores ciphertext. */
  runState: { ciPassword?: string; assetName: string };
  workflow: WorkflowDefinition | null;
  variables: Record<string, unknown>;
};

function provisionMeta(binding: BindingFull): Record<string, unknown> {
  return binding.provisionMeta && typeof binding.provisionMeta === "object" && !Array.isArray(binding.provisionMeta)
    ? binding.provisionMeta as Record<string, unknown>
    : {};
}

function stepConfig(ctx: StepContext, step: ProvisioningStepType): StepConfig | undefined {
  return ctx.workflow?.stepConfigs[step];
}

function resolveInput<T>(ctx: StepContext, step: ProvisioningStepType, key: string, fallback: T): T {
  const binding = stepConfig(ctx, step)?.inputBindings[key];
  if (!binding) return fallback;
  if (binding.startsWith("literal:")) return binding.slice(8) as T;
  return (ctx.variables[binding] ?? fallback) as T;
}

function shouldRunStep(ctx: StepContext, step: ProvisioningStepType): boolean {
  const meta = provisionMeta(ctx.binding);
  if (step === "PVE_SECURITY_GROUP") return resolveInput(ctx, step, "enabled", meta.configureSecurityGroup !== false) !== false && !!ctx.binding.pveSecurityGroup;
  if (step === "EXTERNAL_ACCESS") return !!meta.externalAccess;
  return true;
}

async function loadBinding(bindingId: string): Promise<BindingFull> {
  const binding = await prisma.resourceBinding.findUnique({
    where: { id: bindingId },
    include: { pveNode: true, resource: true, workflowSchema: true },
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

  async CLOUD_INIT(ctx) {
    const { binding, provider, runState } = ctx;
    const password = resolveInput(ctx, "CLOUD_INIT", "password", runState.ciPassword);
    if (!password) throw new Error("initial_password_missing");
    // ipconfig / nameserver come from admin-provided values captured at approve.
    const meta = provisionMeta(binding) as Record<string, string>;
    await provider.provision({
      providerResourceId: binding.resource.providerResourceId,
      displayName: binding.resource.displayName,
      cpuCores: binding.resource.cpuCores,
      ramGB: binding.resource.ramGB,
      diskGB: binding.resource.diskGB,
      cloudInit: {
        username: resolveInput(ctx, "CLOUD_INIT", "username", binding.cloudInitUser),
        password,
        sshKeys: resolveInput(ctx, "CLOUD_INIT", "sshKeys", meta.sshKeys),
        ipConfig: resolveInput(ctx, "CLOUD_INIT", "ipConfig", meta.ipconfig),
        nameserver: resolveInput(ctx, "CLOUD_INIT", "nameserver", meta.nameserver),
      },
    });
    await prisma.resourceBinding.update({
      where: { id: binding.id },
      data: { initialPasswordDeliveredAt: null },
    });
  },

  async DATABASE_BOOTSTRAP(ctx) {
    const engine = String(resolveInput(ctx, "DATABASE_BOOTSTRAP", "engine", ""));
    const databaseName = String(resolveInput(ctx, "DATABASE_BOOTSTRAP", "databaseName", ""));
    const adminUser = String(resolveInput(ctx, "DATABASE_BOOTSTRAP", "adminUser", ""));
    const adminPassword = String(resolveInput(ctx, "DATABASE_BOOTSTRAP", "adminPassword", ""));
    const port = Number(resolveInput(ctx, "DATABASE_BOOTSTRAP", "port", 0));
    if (!["postgresql", "mysql", "redis", "mongodb"].includes(engine)) throw new Error("unsupported_database_engine");
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(databaseName)) throw new Error("invalid_database_name");
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(adminUser)) throw new Error("invalid_database_admin_user");
    if (adminPassword.length < 8 || adminPassword.length > 200) throw new Error("invalid_database_admin_password");
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid_database_port");
    const sqlString = (value: string) => value.replaceAll("'", "''");
    const mysqlString = (value: string) => value.replaceAll("\\", "\\\\").replaceAll("'", "''");
    const pgIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const mysqlIdentifier = (value: string) => `\`${value.replaceAll("`", "``")}\``;
    const shellArg = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
    let script: string;
    if (engine === "postgresql") {
      script = `set -eu\ncommand -v psql >/dev/null\nsudo -n -u postgres psql -v ON_ERROR_STOP=1 <<'CUMULET_SQL'\nDO $cumulet$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${sqlString(adminUser)}') THEN CREATE ROLE ${pgIdentifier(adminUser)} LOGIN PASSWORD '${sqlString(adminPassword)}'; ELSE ALTER ROLE ${pgIdentifier(adminUser)} PASSWORD '${sqlString(adminPassword)}'; END IF; END $cumulet$;\nSELECT 'CREATE DATABASE ${pgIdentifier(databaseName)} OWNER ${pgIdentifier(adminUser)}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${sqlString(databaseName)}')\\gexec\nCUMULET_SQL\n`;
    } else if (engine === "mysql") {
      script = `set -eu\ncommand -v mysql >/dev/null\nmysql --protocol=socket -uroot <<'CUMULET_SQL'\nCREATE DATABASE IF NOT EXISTS ${mysqlIdentifier(databaseName)};\nCREATE USER IF NOT EXISTS '${mysqlString(adminUser)}'@'%' IDENTIFIED BY '${mysqlString(adminPassword)}';\nALTER USER '${mysqlString(adminUser)}'@'%' IDENTIFIED BY '${mysqlString(adminPassword)}';\nGRANT ALL PRIVILEGES ON ${mysqlIdentifier(databaseName)}.* TO '${mysqlString(adminUser)}'@'%';\nFLUSH PRIVILEGES;\nCUMULET_SQL\n`;
    } else if (engine === "redis") {
      script = `set -eu\ncommand -v redis-cli >/dev/null\nredis-cli -p ${port} CONFIG SET requirepass ${shellArg(adminPassword)} >/dev/null\n`;
    } else {
      const jsString = (value: string) => JSON.stringify(value);
      script = `set -eu\ncommand -v mongosh >/dev/null\nmongosh --quiet --port ${port} --eval ${shellArg(`db.getSiblingDB(${jsString(databaseName)}).updateUser(${jsString(adminUser)}, {pwd:${jsString(adminPassword)},roles:[{role:"dbOwner",db:${jsString(databaseName)}}]})`)} || mongosh --quiet --port ${port} --eval ${shellArg(`db.getSiblingDB(${jsString(databaseName)}).createUser({user:${jsString(adminUser)},pwd:${jsString(adminPassword)},roles:[{role:"dbOwner",db:${jsString(databaseName)}}]})`)}\n`;
    }
    await runGuestScript(ctx.pve, ctx.binding.vmid, script);
  },

  async PVE_SECURITY_GROUP(ctx) {
    const { binding, pve, actorId } = ctx;
    const groupName = resolveInput(ctx, "PVE_SECURITY_GROUP", "groupName", binding.pveSecurityGroup);
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

  async JS_ASSET(ctx) {
    const { binding, runState } = ctx;
    const js = await jumpServerClient(binding.boundById);
    const settings = await getSetting("jumpserver");
    const name = resolveInput(ctx, "JS_ASSET", "name", runState.assetName);
    const ticket = await prisma.ticket.findUnique({
      where: { id: binding.ticketId },
      include: { user: true },
    });
    if (!ticket) throw new Error("ticket_missing");
    const userNode = await js.ensureUserAssetNode(
      ticket.user.realName ?? ticket.user.nickname ?? ticket.user.email,
    );

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
        nodeId: userNode.id,
        // Legacy fallback: when no initial password is stored, attach the
        // configured default account template so the asset still has an account.
        accountTemplate: runState.ciPassword ? undefined : settings?.defaultAccountUsername,
      });
      assetId = host.id;
    } else {
      await js.setHostNode(assetId, userNode.id);
    }

    // Sync a managed account with the initially generated credentials so the
    // asset can be connected to with the same user/password given to the
    // requester. Idempotent: find -> create or update secret.
    const accountUsername = (binding.cloudInitUser || "").trim();
    if (accountUsername && runState.ciPassword) {
      const existingAccount = await js.findAccount(assetId, accountUsername);
      if (existingAccount) {
        await js.updateAccountSecret(existingAccount.id, runState.ciPassword);
      } else {
        await js.createAccount({ assetId, username: accountUsername, secret: runState.ciPassword });
      }
    }
    await prisma.resourceBinding.update({
      where: { id: binding.id },
      data: { jsAssetId: assetId },
    });
  },

  async JS_PERMISSION(ctx) {
    const { binding, runState } = ctx;
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
      // The managed account is synced under the cloud-init user whenever an
      // initial password exists; grant on that account (admins may override it
      // through the workflow input). Otherwise keep the legacy default.
      const syncedUsername =
        runState.ciPassword && (binding.cloudInitUser || "").trim() ? binding.cloudInitUser.trim() : "";
      const accountUsername = syncedUsername
        ? String(resolveInput(ctx, "JS_PERMISSION", "accountUsername", syncedUsername))
        : (settings?.defaultAccountUsername ?? "@ALL");
      const perm = await js.createAssetPermission({
        name: `cumulet-${binding.vmid}-${ticket.user.email}`,
        userId: jsUser.id,
        assetId: binding.jsAssetId,
        accountUsername,
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
    const jumpserver = await getSetting("jumpserver");
    const jsPortalUrl = jumpserver?.baseUrl ? jumpServerLunaUrl(jumpserver.baseUrl) : "";

    // One-time credential link (only when a fresh password exists this run).
    let credentialUrl = `${(process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "")}/servers/${binding.id}`;
    if (runState.ciPassword && !binding.initialPasswordDeliveredAt) {
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
              jsPortalUrl,
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
      jsPortalUrl,
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
    const config = stepConfig(ctx, step);
    const outputs: Record<string, unknown> = {};
    await runWithTimeout((async () => {
      await executeHttpRequests(ctx, config, "BEFORE", outputs);
      if (config?.runBuiltIn !== false && shouldRunStep(ctx, step)) await STEP_IMPL[step](ctx);
      await executeHttpRequests(ctx, config, "AFTER", outputs);
    })(), config?.timeoutSeconds);
    await markStep(ctx.binding.id, step, "SUCCESS");
    if (Object.keys(outputs).length) {
      await prisma.provisioningStep.update({
        where: { bindingId_step: { bindingId: ctx.binding.id, step } },
        data: { outputEnc: encryptSecret(JSON.stringify(outputs)) },
      });
    }
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
    const skip = stepConfig(ctx, step)?.failurePolicy === "SKIP";
    await markStep(ctx.binding.id, step, skip ? "SKIPPED" : "FAILED", message);
    await audit({
      actorId: ctx.actorId,
      action: skip ? "pipeline.step.auto_skipped" : "pipeline.step.failed",
      targetType: "ResourceBinding",
      targetId: ctx.binding.id,
      metadata: { step, error: message },
    });
    if (!skip) {
      const ticket = await prisma.ticket.findUnique({ where: { id: ctx.binding.ticketId } });
      if (ticket) void emailStepFailedToAdmins(ticket.id, step, message);
    }
    return skip;
  }
}

function renderRequestTemplate(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{(?:(json|url):)?([a-z][a-zA-Z0-9_.-]*)\}\}/g, (_match, mode: string | undefined, key: string) => {
    if (!(key in variables)) throw new Error(`request_variable_missing_${key}`);
    const value = variables[key];
    if (mode === "json") return JSON.stringify(value);
    if (mode === "url") return encodeURIComponent(String(value ?? ""));
    return typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
  });
}

function expectedStatus(status: number, expression: string): boolean {
  return expression.split(",").some((part) => {
    const [start, end] = part.trim().split("-").map(Number);
    return status >= start && status <= (end || start);
  });
}

async function executeHttpRequests(ctx: StepContext, config: StepConfig | undefined, timing: "BEFORE" | "AFTER", outputs: Record<string, unknown>): Promise<void> {
  for (const request of config?.requests.filter((item) => item.timing === timing) ?? []) {
    await executeHttpRequest(ctx, request, outputs);
  }
}

async function executeHttpRequest(ctx: StepContext, request: HttpRequestConfig, outputs: Record<string, unknown>): Promise<void> {
  let dispatcher: Awaited<ReturnType<typeof safeDispatcher>>["dispatcher"] | undefined;
  try {
    const url = renderRequestTemplate(request.urlTemplate, ctx.variables);
    const resolved = await safeDispatcher(url);
    dispatcher = resolved.dispatcher;
    const forbiddenHeaders = new Set(["host", "content-length", "connection", "transfer-encoding"]);
    const headers = Object.fromEntries(request.headers.map((header) => {
      if (forbiddenHeaders.has(header.name.toLowerCase())) throw new Error("forbidden_request_header");
      return [header.name, renderRequestTemplate(header.valueTemplate, ctx.variables)];
    }));
    const body = request.method === "GET" || request.bodyTemplate === undefined
      ? undefined
      : renderRequestTemplate(request.bodyTemplate, ctx.variables);
    if (body && !Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) headers["Content-Type"] = "application/json";
    const response = await ufetch(resolved.url, { method: request.method, headers, body, dispatcher, signal: AbortSignal.timeout(60_000) });
    if (!expectedStatus(response.status, request.expectedStatuses)) throw new Error(`http_request_${request.id}_status_${response.status}`);
    const text = await response.text();
    if (Buffer.byteLength(text) > 1024 * 1024) throw new Error(`http_request_${request.id}_response_too_large`);
    if (request.captureVariable) {
      let value: unknown = text;
      try { value = text ? JSON.parse(text) : null; } catch { /* keep text response */ }
      outputs[request.captureVariable] = value;
      ctx.variables[`output.${request.captureVariable}`] = value;
    }
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith("http_request_") || error.message.startsWith("request_variable_") || error.message === "forbidden_request_header")) throw error;
    throw new Error(`http_request_${request.id}_failed`);
  } finally {
    if (dispatcher) await dispatcher.close();
  }
}

async function runWithTimeout(execution: Promise<void>, timeoutSeconds?: number): Promise<void> {
  if (!timeoutSeconds) return execution;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      execution,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`step_timeout_${timeoutSeconds}s`)), timeoutSeconds * 1000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runGuestScript(pve: PveClient, vmid: number, script: string): Promise<void> {
  const agentDeadline = Date.now() + 180_000;
  let pid: number | undefined;
  while (!pid && Date.now() < agentDeadline) {
    try {
      pid = await pve.guestExec(vmid, ["/bin/sh"], Buffer.from(script, "utf8"));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  if (!pid) throw new Error("database_guest_agent_unavailable");
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    const status = await pve.guestExecStatus(vmid, pid);
    if (status.exited === 1 || status.exited === true) {
      // Guest output may echo SQL containing credentials, so never persist it.
      if (status.exitcode !== 0) throw new Error(`database_bootstrap_failed_exit_${status.exitcode}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("database_bootstrap_timeout");
}

async function makeContext(binding: BindingFull, actorId: string): Promise<StepContext> {
  const meta = provisionMeta(binding);
  const storedInputs = meta.workflowInputs && typeof meta.workflowInputs === "object" && !Array.isArray(meta.workflowInputs)
    ? meta.workflowInputs as Record<string, unknown>
    : {};
  const approvalVariables = Object.fromEntries(Object.entries(storedInputs).map(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value) && "encrypted" in value) {
      return [`approval.${key}`, decryptSecret(String((value as { encrypted: unknown }).encrypted))];
    }
    return [`approval.${key}`, value];
  }));
  const workflow = binding.workflowSchema ? parseWorkflowDefinition(binding.workflowSchema.definition) : null;
  const password = binding.initialPasswordEnc ? decryptSecret(binding.initialPasswordEnc) : undefined;
  const ticket = await prisma.ticket.findUnique({ where: { id: binding.ticketId }, select: { values: true, user: { select: { email: true } } } });
  const storedOutputs = await prisma.provisioningStep.findMany({ where: { bindingId: binding.id, outputEnc: { not: null } }, select: { outputEnc: true } });
  const outputVariables: Record<string, unknown> = {};
  for (const row of storedOutputs) {
    try {
      const values = JSON.parse(decryptSecret(row.outputEnc!)) as Record<string, unknown>;
      for (const [key, value] of Object.entries(values)) outputVariables[`output.${key}`] = value;
    } catch { /* a corrupt historical output must not block retrying the workflow */ }
  }
  const storedRequestValues = meta.requestValues && typeof meta.requestValues === "object" && !Array.isArray(meta.requestValues)
    ? meta.requestValues as Record<string, unknown>
    : {};
  const requestValues = {
    ...(ticket?.values && typeof ticket.values === "object" && !Array.isArray(ticket.values)
      ? ticket.values as Record<string, unknown>
      : {}),
    ...storedRequestValues,
  };
  return {
    binding,
    pve: pveClient(binding.pveNode, actorId),
    provider: await getHypervisorProvider(binding.resource.providerId, actorId),
    actorId,
    workflow,
    variables: {
      ...approvalVariables,
      ...outputVariables,
      ...Object.fromEntries(Object.entries(requestValues).map(([key, value]) => [`request.${key}`, value])),
      "system.vmid": String(binding.vmid),
      "system.internalIp": binding.internalIp,
      "system.ciUser": binding.cloudInitUser,
      "system.initialPassword": password,
      "system.sshKeys": meta.sshKeys,
      "system.ipconfig": meta.ipconfig,
      "system.nameserver": meta.nameserver,
      "system.configureSecurityGroup": meta.configureSecurityGroup,
      "system.securityGroup": binding.pveSecurityGroup,
      "system.externalAccess": meta.externalAccess,
      "system.resourceName": binding.resource.displayName,
      "system.ownerEmail": ticket?.user.email,
    },
    runState: {
      assetName: binding.resource.displayName,
      ciPassword: password,
    },
  };
}

async function bindingStepOrder(bindingId: string): Promise<ProvisioningStepType[]> {
  const steps = await prisma.provisioningStep.findMany({
    where: { bindingId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { step: true },
  });
  return steps.map((entry) => entry.step);
}

/** Recompute ticket status from the full set of steps. */
async function reconcileTicketStatus(bindingId: string, ticketId: string): Promise<void> {
  const steps = await prisma.provisioningStep.findMany({ where: { bindingId } });
  const allDone = steps.length > 0 && steps.every(
    (entry) => entry.status === "SUCCESS" || entry.status === "SKIPPED",
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

async function continuePipeline(
  ctx: StepContext,
  startIndex: number,
): Promise<boolean> {
  const order = await bindingStepOrder(ctx.binding.id);
  for (const step of order.slice(startIndex)) {
    const existing = await prisma.provisioningStep.findUnique({
      where: { bindingId_step: { bindingId: ctx.binding.id, step } },
    });
    if (existing?.status === "SUCCESS" || existing?.status === "SKIPPED") continue;
    if (!shouldRunStep(ctx, step) && !(stepConfig(ctx, step)?.requests.length)) {
      await markStep(ctx.binding.id, step, "SKIPPED");
      continue;
    }
    if (!(await runStep(ctx, step))) return false;
  }
  await reconcileTicketStatus(ctx.binding.id, ctx.binding.ticketId);
  return true;
}

/** Run the whole pipeline in order, stopping at the first failure. */
export async function runPipeline(bindingId: string, actorId: string): Promise<void> {
  const binding = await loadBinding(bindingId);
  const ctx = await makeContext(binding, actorId);
  if (!(await continuePipeline(ctx, 0))) {
    const ticket = await prisma.ticket.findUnique({ where: { id: binding.ticketId } });
    if (ticket && ticket.status === "PROVISIONING") await addSystemMessage(ticket.id, "provisionFailed");
  }
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
  const idx = (await bindingStepOrder(bindingId)).indexOf(step);
  if (idx < 0) throw new Error("step_not_found");
  await continuePipeline(ctx, idx + 1);
}

/** Deliberately skip a step (recorded + audited). */
export async function skipStep(
  bindingId: string,
  step: ProvisioningStepType,
  actorId: string,
): Promise<void> {
  const binding = await loadBinding(bindingId);
  const existing = await prisma.provisioningStep.findUnique({
    where: { bindingId_step: { bindingId, step } },
  });
  if (!existing || existing.status === "SUCCESS" || existing.status === "SKIPPED") {
    throw new Error("step_not_skippable");
  }
  const ctx = await makeContext(binding, actorId);
  await markStep(bindingId, step, "SKIPPED");
  await audit({
    actorId,
    action: "pipeline.step.skipped",
    targetType: "ResourceBinding",
    targetId: bindingId,
    metadata: { step },
  });
  const idx = (await bindingStepOrder(bindingId)).indexOf(step);
  if (idx < 0) throw new Error("step_not_found");
  await continuePipeline(ctx, idx + 1);
}
