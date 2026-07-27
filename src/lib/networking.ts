import "server-only";
import ipaddr from "ipaddr.js";
import { Agent, fetch as ufetch } from "undici";
import type {
  ExternalAccessMapping,
  ExternalAccessProtocol,
} from "@prisma/client";
import { audit } from "./audit";
import { decryptSecret } from "./crypto";
import { prisma } from "./prisma";

type FrpMapping = Pick<
  ExternalAccessMapping,
  "id" | "protocol" | "internalHost" | "internalPort" | "externalPort" | "hostname"
>;
const TIMEOUT_MS = 10_000;

export function validCidr(value: string): boolean {
  try { ipaddr.parseCIDR(value); return true; } catch { return false; }
}

export function addressInCidr(address: string, cidr: string): boolean {
  try {
    const parsed = ipaddr.parse(address);
    const [range, prefix] = ipaddr.parseCIDR(cidr);
    if (parsed.kind() !== range.kind()) return false;
    return parsed.kind() === "ipv4"
      ? (parsed as ipaddr.IPv4).match(range as ipaddr.IPv4, prefix)
      : (parsed as ipaddr.IPv6).match(range as ipaddr.IPv6, prefix);
  } catch {
    return false;
  }
}

function safeProxyName(mapping: FrpMapping): string {
  return `cumulet_${mapping.id}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

/** Deterministic FRP proxy block; secrets and instance-specific API data stay out. */
export function generateFrpcIni(mapping: FrpMapping): string {
  const lines = [
    `[${safeProxyName(mapping)}]`,
    `type = ${mapping.protocol.toLowerCase()}`,
    `local_ip = ${mapping.internalHost}`,
    `local_port = ${mapping.internalPort}`,
  ];
  if (mapping.protocol === "TCP") lines.push(`remote_port = ${mapping.externalPort}`);
  else lines.push(`custom_domains = ${mapping.hostname}`);
  lines.push("use_encryption = true", "use_compression = true");
  return `${lines.join("\n")}\n`;
}

function serviceUrl(raw: string): URL {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("invalid_gateway_url");
  }
  const host = url.hostname.toLowerCase();
  if (["169.254.169.254", "metadata.google.internal"].includes(host)) {
    throw new Error("gateway_metadata_forbidden");
  }
  return url;
}

export type ExternalAccessRequest = {
  resourceId: string;
  gatewayId: string;
  protocol: ExternalAccessProtocol;
  internalPort: number;
  externalPort?: number | null;
  hostname?: string | null;
  dnsZoneId?: string;
  ttl?: number;
  automationKey?: string;
};

export function ticketRequestsExternalAccess(values: unknown): boolean {
  if (!values || typeof values !== "object" || Array.isArray(values)) return false;
  const record = values as Record<string, unknown>;
  return [record.external_access, record.public_site].some(
    (value) => value === true || value === "true" || value === 1 || value === "1",
  );
}

export async function assertResourceSubnetTenant(
  resourceId: string,
  subnetId: string,
): Promise<{ resourceId: string; subnetId: string; tenantId: string }> {
  const [resource, subnet] = await Promise.all([
    prisma.provisionedResource.findUnique({
      where: { id: resourceId },
      select: { id: true, owner: { select: { tenantMemberships: { select: { tenantId: true } } } } },
    }),
    prisma.subnet.findUnique({
      where: { id: subnetId },
      select: { id: true, network: { select: { tenantId: true } } },
    }),
  ]);
  if (!resource || !subnet) throw new Error("network_scope_not_found");
  const tenantId = subnet.network.tenantId;
  if (!resource.owner.tenantMemberships.some((membership) => membership.tenantId === tenantId)) {
    throw new Error("resource_owner_not_in_tenant");
  }
  return { resourceId: resource.id, subnetId: subnet.id, tenantId };
}

async function loadExternalScope(input: ExternalAccessRequest) {
  const [resource, gateway, zone] = await Promise.all([
    prisma.provisionedResource.findUnique({
      where: { id: input.resourceId },
      include: {
        networkAttachments: {
          select: { subnet: { select: { network: { select: { tenantId: true } } } } },
        },
      },
    }),
    prisma.reverseProxyGateway.findUnique({ where: { id: input.gatewayId } }),
    input.dnsZoneId
      ? prisma.dnsZone.findUnique({ where: { id: input.dnsZoneId } })
      : Promise.resolve(null),
  ]);
  if (!resource || !gateway || !resource.internalIp) throw new Error("external_access_scope_not_found");
  const tenantIds = new Set(
    resource.networkAttachments.map((attachment) => attachment.subnet.network.tenantId),
  );
  if (gateway.tenantId && !tenantIds.has(gateway.tenantId)) {
    throw new Error("gateway_tenant_mismatch");
  }
  if (input.dnsZoneId && !zone) throw new Error("dns_zone_not_found");
  if (zone && !tenantIds.has(zone.tenantId)) throw new Error("dns_zone_tenant_mismatch");
  if (zone && gateway.tenantId && zone.tenantId !== gateway.tenantId) {
    throw new Error("gateway_dns_tenant_mismatch");
  }
  return { resource, gateway, zone };
}

export function generateSplitDnsConfig(record: {
  hostname: string;
  type: string;
  ttl: number;
  internalValue: string;
  externalValue: string;
}): string {
  return `${JSON.stringify({
    hostname: record.hostname,
    type: record.type,
    ttl: record.ttl,
    views: { internal: record.internalValue, external: record.externalValue },
  }, null, 2)}\n`;
}

export async function reconcileDnsRecord(recordId: string, actorId?: string | null) {
  const record = await prisma.dnsRecord.findUnique({
    where: { id: recordId },
    include: { zone: true },
  });
  if (!record) throw new Error("dns_record_not_found");
  const generatedConfig = generateSplitDnsConfig(record);
  let dispatcher: Agent | undefined;
  try {
    if (record.zone.mode === "HTTP_API") {
      if (!record.zone.apiUrl) throw new Error("dns_api_url_missing");
      const url = new URL(
        `api/v1/dns/records/${encodeURIComponent(record.id)}`,
        `${serviceUrl(record.zone.apiUrl).toString().replace(/\/$/, "")}/`,
      );
      dispatcher = record.zone.tlsVerify
        ? undefined
        : new Agent({ connect: { rejectUnauthorized: false } });
      const token = record.zone.secretEnc ? decryptSecret(record.zone.secretEnc) : "";
      const response = await ufetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          id: record.id,
          zone: record.zone.domain,
          hostname: record.hostname,
          type: record.type,
          ttl: record.ttl,
          internalValue: record.internalValue,
          externalValue: record.externalValue,
        }),
        dispatcher,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`dns_http_${response.status}`);
    }
    const now = new Date();
    const [updated] = await prisma.$transaction([
      prisma.dnsRecord.update({
        where: { id: record.id },
        data: {
          status: "ACTIVE",
          generatedConfig,
          lastError: null,
          lastAppliedAt: now,
        },
      }),
      prisma.dnsZone.update({ where: { id: record.zoneId }, data: { lastSyncedAt: now } }),
    ]);
    await audit({
      actorId: actorId ?? null,
      action: "dns.record.reconcile",
      targetType: "DnsRecord",
      targetId: record.id,
      metadata: { mode: record.zone.mode, zoneId: record.zoneId },
    });
    return updated;
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 200) : "dns_sync_failed";
    await prisma.dnsRecord.update({
      where: { id: record.id },
      data: { status: "FAILED", generatedConfig, lastError: code },
    });
    throw new Error(code);
  } finally {
    if (dispatcher) await dispatcher.close().catch(() => undefined);
  }
}

export async function provisionExternalAccess(
  input: ExternalAccessRequest,
  actorId?: string | null,
) {
  if (input.protocol === "TCP" && !input.externalPort) throw new Error("external_port_required");
  if (input.protocol !== "TCP" && !input.hostname) throw new Error("hostname_required");
  const { resource, gateway, zone } = await loadExternalScope(input);

  const mapping = await prisma.$transaction(async (tx) => {
    const data = {
      resourceId: input.resourceId,
      gatewayId: input.gatewayId,
      protocol: input.protocol,
      internalHost: resource.internalIp!,
      internalPort: input.internalPort,
      externalPort: input.protocol === "TCP" ? input.externalPort : null,
      hostname: input.protocol === "TCP" ? null : input.hostname,
    };
    const mapped = input.automationKey
      ? await tx.externalAccessMapping.upsert({
          where: { automationKey: input.automationKey },
          create: { ...data, automationKey: input.automationKey },
          update: data,
        })
      : await tx.externalAccessMapping.create({ data });
    if (zone && input.hostname) {
      await tx.dnsRecord.upsert({
        where: {
          zoneId_hostname_type: { zoneId: zone.id, hostname: input.hostname, type: "A" },
        },
        create: {
          zoneId: zone.id,
          mappingId: mapped.id,
          hostname: input.hostname,
          internalValue: resource.internalIp!,
          externalValue: gateway.publicHost,
          ttl: input.ttl ?? 300,
        },
        update: {
          mappingId: mapped.id,
          internalValue: resource.internalIp!,
          externalValue: gateway.publicHost,
          ttl: input.ttl ?? 300,
          status: "PENDING",
          lastError: null,
        },
      });
    }
    return mapped;
  });

  await audit({
    actorId: actorId ?? null,
    action: "network.external_access.create",
    targetType: "ExternalAccessMapping",
    targetId: mapping.id,
    metadata: { gatewayId: mapping.gatewayId, protocol: mapping.protocol },
  });
  const updated = await reconcileExternalAccess(mapping.id, actorId);
  const records = await prisma.dnsRecord.findMany({
    where: { mappingId: mapping.id },
    select: { id: true },
  });
  for (const record of records) await reconcileDnsRecord(record.id, actorId);
  return updated;
}

export async function reconcileExternalAccess(mappingId: string, actorId?: string | null) {
  const mapping = await prisma.externalAccessMapping.findUnique({
    where: { id: mappingId },
    include: { gateway: true },
  });
  if (!mapping) throw new Error("mapping_not_found");
  if (!mapping.gateway.enabled) throw new Error("gateway_disabled");
  const generatedConfig = generateFrpcIni(mapping);

  let dispatcher: Agent | undefined;
  try {
    if (mapping.gateway.mode === "FRP_HTTP_API") {
      if (!mapping.gateway.apiUrl) throw new Error("gateway_api_url_missing");
      const url = new URL(
        `api/v1/proxies/${encodeURIComponent(mapping.id)}`,
        `${serviceUrl(mapping.gateway.apiUrl).toString().replace(/\/$/, "")}/`,
      );
      dispatcher = mapping.gateway.tlsVerify
        ? undefined
        : new Agent({ connect: { rejectUnauthorized: false } });
      const token = mapping.gateway.secretEnc ? decryptSecret(mapping.gateway.secretEnc) : "";
      const response = await ufetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          id: mapping.id,
          protocol: mapping.protocol.toLowerCase(),
          localIp: mapping.internalHost,
          localPort: mapping.internalPort,
          remotePort: mapping.externalPort,
          hostname: mapping.hostname,
          enabled: true,
        }),
        dispatcher,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`gateway_http_${response.status}`);
    }
    const updated = await prisma.externalAccessMapping.update({
      where: { id: mapping.id },
      data: { status: "ACTIVE", generatedConfig, lastAppliedAt: new Date(), lastError: null },
    });
    await audit({
      actorId: actorId ?? null,
      action: "network.external_access.reconcile",
      targetType: "ExternalAccessMapping",
      targetId: mapping.id,
      metadata: { protocol: mapping.protocol, gatewayId: mapping.gatewayId },
    });
    return updated;
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 200) : "gateway_failed";
    await prisma.externalAccessMapping.update({
      where: { id: mapping.id },
      data: { status: "FAILED", generatedConfig, lastError: code },
    });
    throw new Error(code);
  } finally {
    if (dispatcher) await dispatcher.close().catch(() => undefined);
  }
}

async function deleteAdapterObject(input: {
  baseUrl: string;
  path: string;
  secretEnc: string | null;
  tlsVerify: boolean;
}): Promise<void> {
  let dispatcher: Agent | undefined;
  try {
    const url = new URL(
      input.path,
      `${serviceUrl(input.baseUrl).toString().replace(/\/$/, "")}/`,
    );
    dispatcher = input.tlsVerify
      ? undefined
      : new Agent({ connect: { rejectUnauthorized: false } });
    const token = input.secretEnc ? decryptSecret(input.secretEnc) : "";
    const response = await ufetch(url, {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      dispatcher,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok && response.status !== 404) throw new Error(`adapter_http_${response.status}`);
  } finally {
    if (dispatcher) await dispatcher.close().catch(() => undefined);
  }
}

/** Idempotently revoke FRP and split-DNS state before deleting the mapping. */
export async function removeExternalAccess(mappingId: string, actorId?: string | null) {
  const mapping = await prisma.externalAccessMapping.findUnique({
    where: { id: mappingId },
    include: { gateway: true, dnsRecords: { include: { zone: true } } },
  });
  if (!mapping) return;

  for (const record of mapping.dnsRecords) {
    if (record.zone.mode === "HTTP_API") {
      if (!record.zone.apiUrl) throw new Error("dns_api_url_missing");
      await deleteAdapterObject({
        baseUrl: record.zone.apiUrl,
        path: `api/v1/dns/records/${encodeURIComponent(record.id)}`,
        secretEnc: record.zone.secretEnc,
        tlsVerify: record.zone.tlsVerify,
      });
    }
  }
  if (mapping.gateway.mode === "FRP_HTTP_API") {
    if (!mapping.gateway.apiUrl) throw new Error("gateway_api_url_missing");
    await deleteAdapterObject({
      baseUrl: mapping.gateway.apiUrl,
      path: `api/v1/proxies/${encodeURIComponent(mapping.id)}`,
      secretEnc: mapping.gateway.secretEnc,
      tlsVerify: mapping.gateway.tlsVerify,
    });
  }

  await prisma.$transaction([
    prisma.dnsRecord.deleteMany({ where: { mappingId: mapping.id } }),
    prisma.externalAccessMapping.delete({ where: { id: mapping.id } }),
  ]);
  await audit({
    actorId: actorId ?? null,
    action: "network.external_access.delete",
    targetType: "ExternalAccessMapping",
    targetId: mapping.id,
    metadata: { gatewayId: mapping.gatewayId, dnsRecords: mapping.dnsRecords.length },
  });
}
