CREATE TABLE `ResourceResizeRequest` (
    `id` VARCHAR(191) NOT NULL,
    `resourceId` VARCHAR(191) NOT NULL,
    `requestedById` VARCHAR(191) NOT NULL,
    `decidedById` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'APPLYING', 'APPLIED', 'REJECTED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `beforeCpuCores` INTEGER NOT NULL,
    `beforeRamGB` INTEGER NOT NULL,
    `beforeDiskGB` INTEGER NOT NULL,
    `requestedCpuCores` INTEGER NOT NULL,
    `requestedRamGB` INTEGER NOT NULL,
    `requestedDiskGB` INTEGER NOT NULL,
    `reason` TEXT NULL,
    `decisionReason` TEXT NULL,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `decidedAt` DATETIME(3) NULL,
    `appliedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ResourceResizeRequest_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `ResourceResizeRequest_resourceId_status_idx`(`resourceId`, `status`),
    INDEX `ResourceResizeRequest_requestedById_createdAt_idx`(`requestedById`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ResourceResizeRequest`
  ADD CONSTRAINT `ResourceResizeRequest_resourceId_fkey`
  FOREIGN KEY (`resourceId`) REFERENCES `ProvisionedResource`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ResourceResizeRequest`
  ADD CONSTRAINT `ResourceResizeRequest_requestedById_fkey`
  FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ResourceResizeRequest`
  ADD CONSTRAINT `ResourceResizeRequest_decidedById_fkey`
  FOREIGN KEY (`decidedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
