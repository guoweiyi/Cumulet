-- Provider-neutral infrastructure, tenant networking, webhook delivery, and
-- resource lease lifecycle. This migration keeps all existing PVE bindings.

-- Rename the legacy quota model and normalize RAM from MiB to GiB.
RENAME TABLE `ResourceQuota` TO `UserQuota`;
ALTER TABLE `UserQuota`
  CHANGE COLUMN `maxRamMb` `maxRamGB` INTEGER NOT NULL,
  CHANGE COLUMN `maxDiskGb` `maxDiskGB` INTEGER NOT NULL;
UPDATE `UserQuota`
SET `maxRamGB` = GREATEST(1, CEIL(`maxRamGB` / 1024));
ALTER TABLE `UserQuota` DROP FOREIGN KEY `ResourceQuota_userId_fkey`;
ALTER TABLE `UserQuota` DROP INDEX `ResourceQuota_userId_key`;
CREATE UNIQUE INDEX `UserQuota_userId_key` ON `UserQuota`(`userId`);
ALTER TABLE `UserQuota`
  ADD CONSTRAINT `UserQuota_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `ProviderInstance` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(96) NOT NULL,
  `type` ENUM('PROXMOX', 'ESXI', 'FNOS', 'AWS', 'CUSTOM') NOT NULL,
  `status` ENUM('ACTIVE', 'DISABLED', 'ERROR') NOT NULL DEFAULT 'ACTIVE',
  `config` JSON NOT NULL,
  `secretEnc` TEXT NULL,
  `verifiedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `ProviderInstance_name_key`(`name`),
  INDEX `ProviderInstance_type_status_idx`(`type`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Existing PVE nodes become provider instances without moving their encrypted
-- API tokens. ProxmoxProvider resolves the linked PveNode during transition.
INSERT INTO `ProviderInstance` (`id`, `name`, `type`, `status`, `config`, `verifiedAt`, `createdAt`, `updatedAt`)
SELECT `id`, CONCAT('pve:', `name`), 'PROXMOX',
       IF(`verified`, 'ACTIVE', 'ERROR'), JSON_OBJECT('pveNodeId', `id`),
       `verifiedAt`, `createdAt`, `updatedAt`
FROM `PveNode`;

ALTER TABLE `PveNode` ADD COLUMN `providerInstanceId` VARCHAR(191) NULL;
UPDATE `PveNode` SET `providerInstanceId` = `id`;
CREATE UNIQUE INDEX `PveNode_providerInstanceId_key` ON `PveNode`(`providerInstanceId`);
ALTER TABLE `PveNode`
  ADD CONSTRAINT `PveNode_providerInstanceId_fkey`
  FOREIGN KEY (`providerInstanceId`) REFERENCES `ProviderInstance`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `ProvisionedResource` (
  `id` VARCHAR(191) NOT NULL,
  `ticketId` VARCHAR(191) NOT NULL,
  `ownerId` VARCHAR(191) NOT NULL,
  `providerId` VARCHAR(191) NOT NULL,
  `providerResourceId` VARCHAR(128) NOT NULL,
  `displayName` VARCHAR(128) NOT NULL,
  `cpuCores` INTEGER NOT NULL,
  `ramGB` INTEGER NOT NULL,
  `diskGB` INTEGER NOT NULL,
  `internalIp` VARCHAR(45) NULL,
  `status` ENUM('PROVISIONING', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'PENDING_DELETION', 'DELETED', 'FAILED') NOT NULL DEFAULT 'PROVISIONING',
  `leaseStartTime` DATETIME(3) NOT NULL,
  `leaseDurationDays` INTEGER NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `warningSentAt` DATETIME(3) NULL,
  `expiredAt` DATETIME(3) NULL,
  `deletionDueAt` DATETIME(3) NULL,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `ProvisionedResource_ticketId_key`(`ticketId`),
  UNIQUE INDEX `ProvisionedResource_providerId_providerResourceId_key`(`providerId`, `providerResourceId`),
  INDEX `ProvisionedResource_ownerId_status_idx`(`ownerId`, `status`),
  INDEX `ProvisionedResource_status_expiresAt_idx`(`status`, `expiresAt`),
  INDEX `ProvisionedResource_status_deletionDueAt_idx`(`status`, `deletionDueAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `ProvisionedResource` (
  `id`, `ticketId`, `ownerId`, `providerId`, `providerResourceId`, `displayName`,
  `cpuCores`, `ramGB`, `diskGB`, `internalIp`, `status`, `leaseStartTime`,
  `leaseDurationDays`, `expiresAt`, `expiredAt`, `deletedAt`, `createdAt`, `updatedAt`
)
SELECT binding.`id`, binding.`ticketId`, ticket.`userId`, binding.`pveNodeId`,
       CAST(binding.`vmid` AS CHAR), CONCAT('VM ', binding.`vmid`),
       0, 0, 0, binding.`internalIp`,
       CASE ticket.`status`
         WHEN 'ACTIVE' THEN 'ACTIVE'
         WHEN 'CLOSED' THEN 'DELETED'
         WHEN 'FAILED' THEN 'FAILED'
         ELSE 'PROVISIONING'
       END,
       CURRENT_TIMESTAMP(3), 30, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY),
       IF(ticket.`status` = 'CLOSED', ticket.`closedAt`, NULL),
       IF(ticket.`status` = 'CLOSED', ticket.`closedAt`, NULL),
       binding.`boundAt`, binding.`boundAt`
FROM `ResourceBinding` binding
JOIN `Ticket` ticket ON ticket.`id` = binding.`ticketId`;

ALTER TABLE `ProvisionedResource`
  ADD CONSTRAINT `ProvisionedResource_ticketId_fkey`
    FOREIGN KEY (`ticketId`) REFERENCES `Ticket`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `ProvisionedResource_ownerId_fkey`
    FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `ProvisionedResource_providerId_fkey`
    FOREIGN KEY (`providerId`) REFERENCES `ProviderInstance`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ResourceBinding` ADD COLUMN `resourceId` VARCHAR(191) NULL;
UPDATE `ResourceBinding` SET `resourceId` = `id`;
ALTER TABLE `ResourceBinding` MODIFY `resourceId` VARCHAR(191) NOT NULL;
CREATE UNIQUE INDEX `ResourceBinding_resourceId_key` ON `ResourceBinding`(`resourceId`);
ALTER TABLE `ResourceBinding`
  ADD CONSTRAINT `ResourceBinding_resourceId_fkey`
  FOREIGN KEY (`resourceId`) REFERENCES `ProvisionedResource`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `Tenant` (
  `id` VARCHAR(191) NOT NULL,
  `slug` VARCHAR(64) NOT NULL,
  `name` VARCHAR(128) NOT NULL,
  `createdById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Tenant_slug_key`(`slug`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TenantMembership` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `role` ENUM('MEMBER', 'MANAGER') NOT NULL DEFAULT 'MEMBER',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `TenantMembership_tenantId_userId_key`(`tenantId`, `userId`),
  INDEX `TenantMembership_userId_idx`(`userId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Network` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(96) NOT NULL,
  `routingDomain` VARCHAR(96) NOT NULL,
  `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
  `createdById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Network_tenantId_name_key`(`tenantId`, `name`),
  UNIQUE INDEX `Network_tenantId_routingDomain_key`(`tenantId`, `routingDomain`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Subnet` (
  `id` VARCHAR(191) NOT NULL,
  `networkId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(96) NOT NULL,
  `cidr` VARCHAR(64) NOT NULL,
  `ipVersion` ENUM('IPV4', 'IPV6') NOT NULL DEFAULT 'IPV4',
  `gateway` VARCHAR(45) NULL,
  `dnsServers` JSON NULL,
  `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Subnet_networkId_name_key`(`networkId`, `name`),
  UNIQUE INDEX `Subnet_networkId_cidr_key`(`networkId`, `cidr`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ResourceNetworkAttachment` (
  `id` VARCHAR(191) NOT NULL,
  `resourceId` VARCHAR(191) NOT NULL,
  `subnetId` VARCHAR(191) NOT NULL,
  `ipAddress` VARCHAR(45) NOT NULL,
  `isPrimary` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ResourceNetworkAttachment_resourceId_subnetId_key`(`resourceId`, `subnetId`),
  UNIQUE INDEX `ResourceNetworkAttachment_subnetId_ipAddress_key`(`subnetId`, `ipAddress`),
  INDEX `ResourceNetworkAttachment_resourceId_isPrimary_idx`(`resourceId`, `isPrimary`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ReverseProxyGateway` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NULL,
  `name` VARCHAR(96) NOT NULL,
  `mode` ENUM('FRP_HTTP_API', 'FRPC_CONFIG') NOT NULL,
  `apiUrl` VARCHAR(512) NULL,
  `publicHost` VARCHAR(255) NOT NULL,
  `secretEnc` TEXT NULL,
  `tlsVerify` BOOLEAN NOT NULL DEFAULT true,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ReverseProxyGateway_tenantId_name_key`(`tenantId`, `name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ExternalAccessMapping` (
  `id` VARCHAR(191) NOT NULL,
  `automationKey` VARCHAR(128) NULL,
  `resourceId` VARCHAR(191) NOT NULL,
  `gatewayId` VARCHAR(191) NOT NULL,
  `protocol` ENUM('TCP', 'HTTP', 'HTTPS') NOT NULL,
  `internalHost` VARCHAR(45) NOT NULL,
  `internalPort` INTEGER NOT NULL,
  `externalPort` INTEGER NULL,
  `hostname` VARCHAR(255) NULL,
  `status` ENUM('PENDING', 'ACTIVE', 'FAILED', 'DISABLED') NOT NULL DEFAULT 'PENDING',
  `generatedConfig` TEXT NULL,
  `lastError` TEXT NULL,
  `lastAppliedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ExternalAccessMapping_automationKey_key`(`automationKey`),
  UNIQUE INDEX `ExternalAccessMapping_gatewayId_externalPort_key`(`gatewayId`, `externalPort`),
  UNIQUE INDEX `ExternalAccessMapping_gatewayId_hostname_key`(`gatewayId`, `hostname`),
  INDEX `ExternalAccessMapping_resourceId_status_idx`(`resourceId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DnsZone` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `domain` VARCHAR(255) NOT NULL,
  `mode` ENUM('CONFIG_EXPORT', 'HTTP_API') NOT NULL DEFAULT 'CONFIG_EXPORT',
  `apiUrl` VARCHAR(512) NULL,
  `secretEnc` TEXT NULL,
  `tlsVerify` BOOLEAN NOT NULL DEFAULT true,
  `lastSyncedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `DnsZone_tenantId_domain_key`(`tenantId`, `domain`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DnsRecord` (
  `id` VARCHAR(191) NOT NULL,
  `zoneId` VARCHAR(191) NOT NULL,
  `mappingId` VARCHAR(191) NULL,
  `hostname` VARCHAR(255) NOT NULL,
  `type` ENUM('A', 'AAAA', 'CNAME') NOT NULL DEFAULT 'A',
  `internalValue` VARCHAR(255) NOT NULL,
  `externalValue` VARCHAR(255) NOT NULL,
  `ttl` INTEGER NOT NULL DEFAULT 300,
  `status` ENUM('PENDING', 'ACTIVE', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `generatedConfig` TEXT NULL,
  `lastError` TEXT NULL,
  `lastAppliedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `DnsRecord_zoneId_hostname_type_key`(`zoneId`, `hostname`, `type`),
  INDEX `DnsRecord_mappingId_idx`(`mappingId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WebhookEndpoint` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NULL,
  `name` VARCHAR(96) NOT NULL,
  `url` VARCHAR(1024) NOT NULL,
  `signingSecretEnc` TEXT NULL,
  `events` JSON NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `createdById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `WebhookEndpoint_tenantId_name_key`(`tenantId`, `name`),
  INDEX `WebhookEndpoint_enabled_idx`(`enabled`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WebhookDelivery` (
  `id` VARCHAR(191) NOT NULL,
  `endpointId` VARCHAR(191) NOT NULL,
  `eventId` VARCHAR(64) NOT NULL,
  `eventType` ENUM('TICKET_STATUS_CHANGED', 'RESOURCE_PROVISIONED', 'RESOURCE_EXPIRED', 'RESOURCE_PENDING_DELETION') NOT NULL,
  `payload` JSON NOT NULL,
  `status` ENUM('PENDING', 'DELIVERING', 'SUCCESS', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `responseStatus` INTEGER NULL,
  `errorMessage` TEXT NULL,
  `deliveredAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `WebhookDelivery_endpointId_eventId_key`(`endpointId`, `eventId`),
  INDEX `WebhookDelivery_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Tenant`
  ADD CONSTRAINT `Tenant_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `TenantMembership`
  ADD CONSTRAINT `TenantMembership_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `TenantMembership_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Network`
  ADD CONSTRAINT `Network_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `Network_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Subnet`
  ADD CONSTRAINT `Subnet_networkId_fkey` FOREIGN KEY (`networkId`) REFERENCES `Network`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ResourceNetworkAttachment`
  ADD CONSTRAINT `ResourceNetworkAttachment_resourceId_fkey` FOREIGN KEY (`resourceId`) REFERENCES `ProvisionedResource`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `ResourceNetworkAttachment_subnetId_fkey` FOREIGN KEY (`subnetId`) REFERENCES `Subnet`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ReverseProxyGateway`
  ADD CONSTRAINT `ReverseProxyGateway_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ExternalAccessMapping`
  ADD CONSTRAINT `ExternalAccessMapping_resourceId_fkey` FOREIGN KEY (`resourceId`) REFERENCES `ProvisionedResource`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `ExternalAccessMapping_gatewayId_fkey` FOREIGN KEY (`gatewayId`) REFERENCES `ReverseProxyGateway`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `DnsZone`
  ADD CONSTRAINT `DnsZone_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DnsRecord`
  ADD CONSTRAINT `DnsRecord_zoneId_fkey` FOREIGN KEY (`zoneId`) REFERENCES `DnsZone`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `DnsRecord_mappingId_fkey` FOREIGN KEY (`mappingId`) REFERENCES `ExternalAccessMapping`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `WebhookEndpoint`
  ADD CONSTRAINT `WebhookEndpoint_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `WebhookEndpoint_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `WebhookDelivery`
  ADD CONSTRAINT `WebhookDelivery_endpointId_fkey` FOREIGN KEY (`endpointId`) REFERENCES `WebhookEndpoint`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ProvisioningStep`
  MODIFY `step` ENUM('VALIDATE_VMID', 'CLOUD_INIT', 'PVE_SECURITY_GROUP', 'EXTERNAL_ACCESS', 'JS_ASSET', 'JS_PERMISSION', 'NOTIFY') NOT NULL;
