-- Dynamic form engine: forms become one portable JSON `definition` document.
-- Drops the normalized FormField table and the FormSchema.name column; adds
-- FormSchema.definition + updatedAt.
--
-- Written to apply cleanly whether FormSchema is empty (fresh reset) or already
-- has rows: new NOT NULL columns are added nullable, backfilled, then tightened.
-- The final column shapes (JSON NOT NULL / DATETIME(3) NOT NULL, no defaults)
-- match the Prisma schema exactly, so there is no drift afterward.

-- DropForeignKey
ALTER TABLE `FormField` DROP FOREIGN KEY `FormField_schemaId_fkey`;

-- DropTable
DROP TABLE `FormField`;

-- FormSchema.name → definition
ALTER TABLE `FormSchema` DROP COLUMN `name`;

ALTER TABLE `FormSchema` ADD COLUMN `definition` JSON NULL;
-- Any pre-existing (legacy) form gets a valid empty definition so the NOT NULL
-- constraint can be enforced; admins can delete or replace it afterwards.
UPDATE `FormSchema`
  SET `definition` = '{"formatVersion":1,"meta":{"name":{"zh":"(legacy)","en":"(legacy)"},"description":{"zh":""},"defaultLocale":"zh"},"fields":[]}'
  WHERE `definition` IS NULL;
ALTER TABLE `FormSchema` MODIFY COLUMN `definition` JSON NOT NULL;

-- Add updatedAt (no DB default, to match Prisma's @updatedAt).
ALTER TABLE `FormSchema` ADD COLUMN `updatedAt` DATETIME(3) NULL;
UPDATE `FormSchema` SET `updatedAt` = CURRENT_TIMESTAMP(3) WHERE `updatedAt` IS NULL;
ALTER TABLE `FormSchema` MODIFY COLUMN `updatedAt` DATETIME(3) NOT NULL;
