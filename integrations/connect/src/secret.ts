import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encrypts small secrets, such as a shop's iShip token, for storage.
 *
 * The key is 32 bytes, given as 64 hex characters or as base64. Output is
 * "v1:" followed by base64 of IV, auth tag and ciphertext (AES-256-GCM).
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(key: string) {
    const bytes = /^[0-9a-f]{64}$/i.test(key) ? Buffer.from(key, "hex") : Buffer.from(key, "base64");
    if (bytes.length !== 32) throw new Error("encryption key must be 32 bytes (64 hex characters or base64)");
    this.key = bytes;
  }

  /** A fresh random key in the form the constructor accepts. */
  static generateKey(): string {
    return randomBytes(32).toString("hex");
  }

  seal(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return "v1:" + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
  }

  open(sealed: string): string {
    if (!sealed.startsWith("v1:")) throw new Error("unknown secret format");
    const raw = Buffer.from(sealed.slice(3), "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  }
}
