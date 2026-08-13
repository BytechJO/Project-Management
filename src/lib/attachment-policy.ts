export const attachmentMaxBytes = 10 * 1024 * 1024;

const blockedExtensions = new Set([
  "bat", "cmd", "com", "cpl", "dll", "exe", "hta", "iso", "jar", "js", "jse", "lnk",
  "msi", "msp", "ps1", "reg", "scr", "vbe", "vbs", "wsf", "wsh",
]);

export type AttachmentDescriptor = {
  name: string;
  sizeBytes: number;
  mimeType: string;
};

export function safeAttachmentName(value: string) {
  return value
    .replace(/^.*[\\/]/, "")
    .replace(/[\u0000-\u001f\u007f"*:<>?\\/|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 160);
}

export function validateAttachmentDescriptor(input: {
  name: string;
  size: number;
  type?: string | null;
}): AttachmentDescriptor {
  const name = safeAttachmentName(input.name);
  if (!name) throw new Error("Attachment file name is invalid.");
  if (!Number.isSafeInteger(input.size) || input.size <= 0) {
    throw new Error("Attachment file cannot be empty.");
  }
  if (input.size > attachmentMaxBytes) {
    throw new Error("Attachment file must be 10 MB or smaller.");
  }

  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (blockedExtensions.has(extension)) {
    throw new Error("Attachment file type is not allowed for security reasons.");
  }

  const candidateType = (input.type ?? "").trim().toLowerCase();
  const mimeType = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(candidateType)
    ? candidateType.slice(0, 120)
    : "application/octet-stream";

  return { name, sizeBytes: input.size, mimeType };
}

export function formatAttachmentSize(sizeBytes: number | null) {
  if (!sizeBytes || sizeBytes < 1) return null;
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.ceil(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}
