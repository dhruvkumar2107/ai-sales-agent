import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env, isProd } from "../config";

const ALGO = "aes-256-gcm";

function key(): Buffer {
  if (env.ENCRYPTION_KEY) {
    const k = Buffer.from(env.ENCRYPTION_KEY, "base64");
    if (k.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    return k;
  }
  if (isProd) throw new Error("ENCRYPTION_KEY is required in production");
  // Deterministic dev key so local data stays readable across restarts. Never used in production.
  return createHash("sha256").update("axo-dev-only-key").digest();
}

/** Encrypt bytes: output = iv(12) | tag(16) | ciphertext */
export function encryptBuffer(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]);
}

export function decryptBuffer(blob: Buffer): Buffer {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
}

export function encryptString(plain: string): string {
  return "enc:" + encryptBuffer(Buffer.from(plain, "utf8")).toString("base64");
}

export function decryptString(value: string): string {
  if (!value.startsWith("enc:")) return value;
  return decryptBuffer(Buffer.from(value.slice(4), "base64")).toString("utf8");
}

export function hmacSha256(secret: string, payload: string | Buffer): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Show only the last 4 characters of a secret, e.g. for settings screens. */
export function redactSecret(value: string | undefined): string {
  if (!value) return "";
  const plain = decryptString(value);
  return plain.length <= 4 ? "****" : `****${plain.slice(-4)}`;
}
