import { z } from "zod";

const seedAdminSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z
    .string()
    .min(12)
    .max(200)
    .refine((value) => /[A-Za-z]/.test(value) && /[0-9]/.test(value)),
});

export function seedAdminConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const parsed = seedAdminSchema.safeParse({
    email: env.SEED_ADMIN_EMAIL,
    password: env.SEED_ADMIN_PASSWORD,
  });
  if (!parsed.success) {
    throw new Error(buildSeedConfigError(parsed.error));
  }
  return parsed.data;
}

function buildSeedConfigError(error: z.ZodError): string {
  const lines = [
    "First-boot seeding requires a SUPER_ADMIN account (SEED_ON_START=true):",
  ];
  for (const issue of error.issues) {
    if (issue.path[0] !== "email" && issue.path[0] !== "password") continue;
    const field = issue.path[0] === "email" ? "SEED_ADMIN_EMAIL" : "SEED_ADMIN_PASSWORD";
    switch (issue.code) {
      case "invalid_type":
        lines.push(`  - ${field} is required`);
        break;
      case "invalid_format":
        lines.push(`  - ${field} must be a valid email address (e.g. admin@example.com)`);
        break;
      case "too_small":
        lines.push(
          `  - ${field} must be at least ${(issue as { minimum?: number }).minimum ?? 12} characters`,
        );
        break;
      case "too_big":
        lines.push(`  - ${field} must be at most 200 characters`);
        break;
      case "custom":
        lines.push(`  - ${field} must contain at least one letter and one number`);
        break;
      default:
        lines.push(`  - ${field} is invalid: ${issue.message}`);
    }
  }
  lines.push(
    "Fix these values in your compose .env, then restart the stack with: docker compose up -d",
  );
  return lines.join("\n");
}
