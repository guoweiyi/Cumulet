import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { validateDefinition } from "../src/lib/form-engine/definition";
import defaultForm from "./seed-data/default-form.json";
import { seedAdminConfig } from "./seed-config";

/**
 * Idempotent seed: a SUPER_ADMIN, baseline settings, and the built-in default
 * form (Appendix A). The form is loaded through the SAME `validateDefinition`
 * gate as the admin Import button and then published — proving the JSON format
 * round-trips. Configure the admin via SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
 */
const prisma = new PrismaClient();

async function main() {
  const { email, password } = seedAdminConfig();

  const admin = await prisma.user.upsert({
    where: { email },
    create: { email, nickname: "Super Admin", realName: "Super Admin", role: "SUPER_ADMIN" },
    update: { role: "SUPER_ADMIN" },
  });
  await prisma.adminCredential.upsert({
    where: { userId: admin.id },
    create: { userId: admin.id, passwordHash: await bcrypt.hash(password, 12) },
    update: {},
  });

  await prisma.systemSetting.upsert({
    where: { key: "defaultQuota" },
    create: {
      key: "defaultQuota",
      value: { maxCpuCores: 4, maxRamGB: 8, maxDiskGB: 100, maxFirewallRules: 20 },
      updatedById: admin.id,
    },
    update: {},
  });

  // Built-in default form — only when no form exists yet (idempotent).
  const formCount = await prisma.formSchema.count();
  if (formCount === 0) {
    const result = validateDefinition(defaultForm, "zh");
    if (!result.ok) {
      throw new Error(`Default form failed validation: ${result.errors.map((e) => e.message).join("; ")}`);
    }
    await prisma.formSchema.create({
      data: {
        familyKey: "default_cloud_request",
        version: 1,
        status: "PUBLISHED",
        publishedAt: new Date(),
        definition: result.definition as unknown as Prisma.InputJsonValue,
        createdById: admin.id,
      },
    });
    console.log("Seeded and published the built-in default form.");
  }

  console.log(`Seeded SUPER_ADMIN: ${email}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
