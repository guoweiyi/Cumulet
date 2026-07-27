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
    throw new Error(
      "SEED_ADMIN_EMAIL and a 12+ character SEED_ADMIN_PASSWORD containing letters and numbers are required",
    );
  }
  return parsed.data;
}
