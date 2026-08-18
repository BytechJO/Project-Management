import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const version = "v1";
const context = Buffer.from("bytech:onedrive:v1", "utf8");

function encryptionKey(secret: string) {
  if (secret.length < 32) {
    throw new Error("OneDrive token encryption key must contain at least 32 characters.");
  }

  return createHash("sha256").update(context).update(secret, "utf8").digest();
}

export function encryptOneDriveValue(value: string, secret: string) {
  if (!value || value.length > 16_000) throw new Error("Invalid OneDrive secret value.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  cipher.setAAD(context);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [version, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptOneDriveValue(payload: string, secret: string) {
  if (!payload || payload.length > 32_000) throw new Error("Invalid encrypted OneDrive value.");
  const [payloadVersion, ivValue, tagValue, encryptedValue, extra] = payload.split(".");
  if (payloadVersion !== version || !ivValue || !tagValue || !encryptedValue || extra) {
    throw new Error("Invalid encrypted OneDrive value.");
  }

  try {
    const iv = Buffer.from(ivValue, "base64url");
    const tag = Buffer.from(tagValue, "base64url");
    const encrypted = Buffer.from(encryptedValue, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) {
      throw new Error("Invalid encrypted OneDrive value.");
    }
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), iv);
    decipher.setAAD(context);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Invalid encrypted OneDrive value.");
  }
}

export function encryptOneDriveJson(value: object, secret: string) {
  return encryptOneDriveValue(JSON.stringify(value), secret);
}

export function decryptOneDriveJson<T>(payload: string, secret: string) {
  try {
    return JSON.parse(decryptOneDriveValue(payload, secret)) as T;
  } catch {
    throw new Error("Invalid OneDrive authorization session.");
  }
}
