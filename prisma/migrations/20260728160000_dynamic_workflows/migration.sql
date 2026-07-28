CREATE TABLE `WorkflowSchema` (
  `id` VARCHAR(191) NOT NULL,
  `familyKey` VARCHAR(64) NOT NULL,
  `version` INTEGER NOT NULL,
  `status` ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  `definition` JSON NOT NULL,
  `createdById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `publishedAt` DATETIME(3) NULL,
  UNIQUE INDEX `WorkflowSchema_familyKey_version_key`(`familyKey`, `version`),
  INDEX `WorkflowSchema_status_idx`(`status`),
  PRIMARY KEY (`id`),
  CONSTRAINT `WorkflowSchema_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ResourceWorkflowBinding` (
  `id` VARCHAR(191) NOT NULL,
  `resourceType` VARCHAR(64) NOT NULL,
  `workflowSchemaId` VARCHAR(191) NOT NULL,
  `updatedById` VARCHAR(191) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ResourceWorkflowBinding_resourceType_key`(`resourceType`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ResourceWorkflowBinding_workflowSchemaId_fkey`
    FOREIGN KEY (`workflowSchemaId`) REFERENCES `WorkflowSchema`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ResourceWorkflowBinding_updatedById_fkey`
    FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ResourceBinding`
  ADD COLUMN `initialPasswordEnc` TEXT NULL,
  ADD COLUMN `workflowSchemaId` VARCHAR(191) NULL;

ALTER TABLE `ResourceBinding`
  ADD CONSTRAINT `ResourceBinding_workflowSchemaId_fkey`
    FOREIGN KEY (`workflowSchemaId`) REFERENCES `WorkflowSchema`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ProvisioningStep`
  ADD COLUMN `position` INTEGER NOT NULL DEFAULT 0;

INSERT INTO `WorkflowSchema`
  (`id`, `familyKey`, `version`, `status`, `definition`, `createdById`, `createdAt`, `updatedAt`, `publishedAt`)
VALUES
  (
    'builtin_server_workflow_v1',
    'builtin_server_workflow',
    1,
    'PUBLISHED',
    JSON_OBJECT(
      'formatVersion', 1,
      'meta', JSON_OBJECT('name', JSON_OBJECT('zh', '服务器开通流水线', 'en', 'Server Provisioning'), 'resourceType', 'vm'),
      'steps', JSON_ARRAY('VALIDATE_VMID', 'CLOUD_INIT', 'PVE_SECURITY_GROUP', 'EXTERNAL_ACCESS', 'JS_ASSET', 'JS_PERMISSION', 'NOTIFY'),
      'detailModules', JSON_ARRAY('summary', 'connection', 'configuration', 'ai', 'monitoring', 'logs', 'console')
    ),
    NULL,
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
  ),
  (
    'builtin_database_workflow_v1',
    'builtin_database_workflow',
    1,
    'PUBLISHED',
    JSON_OBJECT(
      'formatVersion', 1,
      'meta', JSON_OBJECT('name', JSON_OBJECT('zh', '数据库开通流水线', 'en', 'Database Provisioning'), 'resourceType', 'database'),
      'steps', JSON_ARRAY('VALIDATE_VMID', 'CLOUD_INIT', 'PVE_SECURITY_GROUP', 'JS_ASSET', 'JS_PERMISSION', 'NOTIFY'),
      'detailModules', JSON_ARRAY('summary', 'connection', 'configuration', 'logs')
    ),
    NULL,
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
  );

INSERT INTO `ResourceWorkflowBinding`
  (`id`, `resourceType`, `workflowSchemaId`, `updatedById`, `updatedAt`)
VALUES
  ('builtin_server_workflow_binding', 'vm', 'builtin_server_workflow_v1', NULL, CURRENT_TIMESTAMP(3)),
  ('builtin_database_workflow_binding', 'database', 'builtin_database_workflow_v1', NULL, CURRENT_TIMESTAMP(3));

UPDATE `ProvisioningStep` AS `stepRow`
JOIN (
  SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `bindingId` ORDER BY `createdAt`, `id`) - 1 AS `position`
  FROM `ProvisioningStep`
) AS `ordered` ON `ordered`.`id` = `stepRow`.`id`
SET `stepRow`.`position` = `ordered`.`position`;
