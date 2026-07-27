-- CreateEnum is represented as native MySQL ENUM columns below.

CREATE TABLE `AiInspectionLog` (
    `id` VARCHAR(191) NOT NULL,
    `bindingId` VARCHAR(191) NOT NULL,
    `requestedById` VARCHAR(191) NULL,
    `trigger` ENUM('USER_ON_DEMAND', 'ADMIN_ON_DEMAND', 'SCHEDULED') NOT NULL,
    `status` ENUM('RUNNING', 'SUCCESS', 'FAILED') NOT NULL DEFAULT 'RUNNING',
    `severity` ENUM('HEALTHY', 'WARNING', 'CRITICAL', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `healthScore` INTEGER NULL,
    `modelName` VARCHAR(128) NULL,
    `metricSummary` JSON NULL,
    `analysis` JSON NULL,
    `errorMessage` TEXT NULL,
    `alertTicketId` VARCHAR(191) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AiInspectionLog_alertTicketId_key`(`alertTicketId`),
    INDEX `AiInspectionLog_bindingId_createdAt_idx`(`bindingId`, `createdAt`),
    INDEX `AiInspectionLog_status_severity_createdAt_idx`(`status`, `severity`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `JobLease` (
    `key` VARCHAR(64) NOT NULL,
    `holderId` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AiInspectionLog` ADD CONSTRAINT `AiInspectionLog_bindingId_fkey`
  FOREIGN KEY (`bindingId`) REFERENCES `ResourceBinding`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AiInspectionLog` ADD CONSTRAINT `AiInspectionLog_requestedById_fkey`
  FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `AiInspectionLog` ADD CONSTRAINT `AiInspectionLog_alertTicketId_fkey`
  FOREIGN KEY (`alertTicketId`) REFERENCES `Ticket`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
