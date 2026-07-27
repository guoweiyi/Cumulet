-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `oidcSub` VARCHAR(191) NULL,
    `email` VARCHAR(191) NOT NULL,
    `nickname` VARCHAR(64) NULL,
    `realName` VARCHAR(64) NULL,
    `realNameSetAt` DATETIME(3) NULL,
    `role` ENUM('USER', 'AUDITOR', 'ADMIN', 'SUPER_ADMIN') NOT NULL DEFAULT 'USER',
    `preferredLocale` VARCHAR(8) NOT NULL DEFAULT 'zh',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_oidcSub_key`(`oidcSub`),
    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminCredential` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(255) NULL,
    `failedLoginCount` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AdminCredential_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WebAuthnCredential` (
    `id` VARCHAR(191) NOT NULL,
    `credentialId` VARCHAR(255) NOT NULL,
    `adminCredId` VARCHAR(191) NOT NULL,
    `publicKey` LONGBLOB NOT NULL,
    `counter` BIGINT NOT NULL DEFAULT 0,
    `transports` VARCHAR(255) NULL,
    `deviceType` VARCHAR(32) NULL,
    `backedUp` BOOLEAN NOT NULL DEFAULT false,
    `label` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NULL,

    UNIQUE INDEX `WebAuthnCredential_credentialId_key`(`credentialId`),
    INDEX `WebAuthnCredential_adminCredId_idx`(`adminCredId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FormSchema` (
    `id` VARCHAR(191) NOT NULL,
    `familyKey` VARCHAR(64) NOT NULL,
    `version` INTEGER NOT NULL,
    `status` ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `name` JSON NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `publishedAt` DATETIME(3) NULL,

    INDEX `FormSchema_status_idx`(`status`),
    UNIQUE INDEX `FormSchema_familyKey_version_key`(`familyKey`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FormField` (
    `id` VARCHAR(191) NOT NULL,
    `schemaId` VARCHAR(191) NOT NULL,
    `fieldKey` VARCHAR(64) NOT NULL,
    `type` ENUM('TEXT', 'DROPDOWN', 'RADIO_CARD', 'STEPPER', 'SLIDER', 'TOGGLE') NOT NULL,
    `label` JSON NOT NULL,
    `hint` JSON NULL,
    `defaultValue` JSON NULL,
    `required` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL,
    `options` JSON NULL,
    `minValue` INTEGER NULL,
    `maxValue` INTEGER NULL,
    `stepValue` INTEGER NULL,
    `conditionalLogic` JSON NULL,

    INDEX `FormField_schemaId_sortOrder_idx`(`schemaId`, `sortOrder`),
    UNIQUE INDEX `FormField_schemaId_fieldKey_key`(`schemaId`, `fieldKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Ticket` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `formSchemaId` VARCHAR(191) NOT NULL,
    `values` JSON NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'PROVISIONING', 'ACTIVE', 'FAILED', 'CLOSED') NOT NULL DEFAULT 'PENDING',
    `decidedById` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Ticket_userId_status_idx`(`userId`, `status`),
    INDEX `Ticket_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TicketMessage` (
    `id` VARCHAR(191) NOT NULL,
    `ticketId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NULL,
    `body` TEXT NOT NULL,
    `isInternalNote` BOOLEAN NOT NULL DEFAULT false,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TicketMessage_ticketId_createdAt_idx`(`ticketId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PveNode` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `nodeName` VARCHAR(64) NOT NULL,
    `apiUrl` VARCHAR(255) NOT NULL,
    `tokenId` VARCHAR(128) NOT NULL,
    `tokenSecretEnc` VARCHAR(512) NOT NULL,
    `tlsVerify` BOOLEAN NOT NULL DEFAULT true,
    `verified` BOOLEAN NOT NULL DEFAULT false,
    `verifiedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PveNode_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ResourceBinding` (
    `id` VARCHAR(191) NOT NULL,
    `ticketId` VARCHAR(191) NOT NULL,
    `pveNodeId` VARCHAR(191) NOT NULL,
    `vmid` INTEGER NOT NULL,
    `internalIp` VARCHAR(45) NOT NULL,
    `boundById` VARCHAR(191) NOT NULL,
    `boundAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `cloudInitUser` VARCHAR(32) NOT NULL,
    `initialPasswordDeliveredAt` DATETIME(3) NULL,
    `provisionMeta` JSON NULL,
    `pveSecurityGroup` VARCHAR(64) NULL,
    `jsAssetId` VARCHAR(64) NULL,
    `jsPermissionId` VARCHAR(64) NULL,

    UNIQUE INDEX `ResourceBinding_ticketId_key`(`ticketId`),
    UNIQUE INDEX `ResourceBinding_pveNodeId_vmid_key`(`pveNodeId`, `vmid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProvisioningStep` (
    `id` VARCHAR(191) NOT NULL,
    `bindingId` VARCHAR(191) NOT NULL,
    `step` ENUM('VALIDATE_VMID', 'CLOUD_INIT', 'PVE_SECURITY_GROUP', 'JS_ASSET', 'JS_PERMISSION', 'NOTIFY') NOT NULL,
    `status` ENUM('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `errorMessage` TEXT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProvisioningStep_bindingId_step_key`(`bindingId`, `step`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OneTimeCredential` (
    `id` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(128) NOT NULL,
    `bindingId` VARCHAR(191) NOT NULL,
    `payloadEnc` TEXT NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `OneTimeCredential_tokenHash_key`(`tokenHash`),
    INDEX `OneTimeCredential_bindingId_idx`(`bindingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ResourceQuota` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `maxCpuCores` INTEGER NOT NULL,
    `maxRamMb` INTEGER NOT NULL,
    `maxDiskGb` INTEGER NOT NULL,
    `maxFirewallRules` INTEGER NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ResourceQuota_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SecurityGroup` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `description` JSON NULL,
    `scope` ENUM('ADMIN_ONLY', 'SHARED') NOT NULL DEFAULT 'ADMIN_ONLY',
    `isProvisioningDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdById` VARCHAR(191) NULL,
    `lastSyncedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SecurityGroup_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VmFirewallBaseline` (
    `id` VARCHAR(191) NOT NULL,
    `bindingId` VARCHAR(191) NOT NULL,
    `rules` JSON NOT NULL,
    `updatedById` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `VmFirewallBaseline_bindingId_key`(`bindingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SystemSetting` (
    `key` VARCHAR(64) NOT NULL,
    `value` JSON NOT NULL,
    `updatedById` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `action` VARCHAR(128) NOT NULL,
    `targetType` VARCHAR(64) NULL,
    `targetId` VARCHAR(64) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_actorId_createdAt_idx`(`actorId`, `createdAt`),
    INDEX `AuditLog_targetType_targetId_idx`(`targetType`, `targetId`),
    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AdminCredential` ADD CONSTRAINT `AdminCredential_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WebAuthnCredential` ADD CONSTRAINT `WebAuthnCredential_adminCredId_fkey` FOREIGN KEY (`adminCredId`) REFERENCES `AdminCredential`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FormSchema` ADD CONSTRAINT `FormSchema_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FormField` ADD CONSTRAINT `FormField_schemaId_fkey` FOREIGN KEY (`schemaId`) REFERENCES `FormSchema`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ticket` ADD CONSTRAINT `Ticket_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ticket` ADD CONSTRAINT `Ticket_formSchemaId_fkey` FOREIGN KEY (`formSchemaId`) REFERENCES `FormSchema`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ticket` ADD CONSTRAINT `Ticket_decidedById_fkey` FOREIGN KEY (`decidedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketMessage` ADD CONSTRAINT `TicketMessage_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `Ticket`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketMessage` ADD CONSTRAINT `TicketMessage_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ResourceBinding` ADD CONSTRAINT `ResourceBinding_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `Ticket`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ResourceBinding` ADD CONSTRAINT `ResourceBinding_pveNodeId_fkey` FOREIGN KEY (`pveNodeId`) REFERENCES `PveNode`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ResourceBinding` ADD CONSTRAINT `ResourceBinding_boundById_fkey` FOREIGN KEY (`boundById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProvisioningStep` ADD CONSTRAINT `ProvisioningStep_bindingId_fkey` FOREIGN KEY (`bindingId`) REFERENCES `ResourceBinding`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OneTimeCredential` ADD CONSTRAINT `OneTimeCredential_bindingId_fkey` FOREIGN KEY (`bindingId`) REFERENCES `ResourceBinding`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ResourceQuota` ADD CONSTRAINT `ResourceQuota_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SecurityGroup` ADD CONSTRAINT `SecurityGroup_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VmFirewallBaseline` ADD CONSTRAINT `VmFirewallBaseline_bindingId_fkey` FOREIGN KEY (`bindingId`) REFERENCES `ResourceBinding`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VmFirewallBaseline` ADD CONSTRAINT `VmFirewallBaseline_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SystemSetting` ADD CONSTRAINT `SystemSetting_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
