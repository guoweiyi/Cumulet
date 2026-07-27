import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  createHash,
  timingSafeEqual,
} from "crypto";

/**
 * AES-256-GCM encryption for secrets at rest (PVE tokens, JumpServer keys,
 * SMTP passwords, one-time credential payloads).
 * Ciphertext format: base64(iv).base64(tag).base64(data)
 */

function key(): Buffer {
  const hex = process.env.APP_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("APP_ENCRYPTION_KEY must be 64 hex chars (32 bytes). Generate with: openssl rand -hex 32");
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${data.toString("base64")}`;
}

export function decryptSecret(ciphertext: string): string {
  const [iv, tag, data] = ciphertext.split(".");
  if (!iv || !tag || !data) throw new Error("Malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

/** Opaque URL-safe random token (for one-time credential links). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** SHA-256 hash of a token — only the hash is persisted. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Short-lived HMAC-signed payloads (WebAuthn challenges, passkey login
 * hand-off tokens). Format: base64url(json).base64url(hmac)
 */
export function signPayload(payload: object, ttlSeconds: number): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 }),
  ).toString("base64url");
  const mac = createHmac("sha256", key()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyPayload<T>(token: string): T | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", key()).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return parsed as T;
  } catch {
    return null;
  }
}
