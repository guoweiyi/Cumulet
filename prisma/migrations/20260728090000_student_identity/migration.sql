ALTER TABLE `User`
  ADD COLUMN `studentId` VARCHAR(32) NULL,
  ADD COLUMN `studentIdSetAt` DATETIME(3) NULL;

CREATE UNIQUE INDEX `User_studentId_key` ON `User`(`studentId`);
