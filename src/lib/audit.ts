import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

const SECRET_KEY_RE = /(password|secret|token|cipassword|credential|key)/i;

/** Recursively mask secret-looking fields so they never reach audit storage. */
export function maskSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) ? "***" : maskSecrets(v);
    }
    return out;
  }
  return value;
}

export async function audit(entry: {
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: unknown;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        metadata: entry.metadata === undefined
          ? Prisma.JsonNull
          : (maskSecrets(entry.metadata) as Prisma.InputJsonValue),
      },
    });
  } catch (err) {
    // Auditing must never take down the action itself.
    console.error("[audit] failed to write audit log:", err);
  }
}
