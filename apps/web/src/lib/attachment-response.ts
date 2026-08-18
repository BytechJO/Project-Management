import "server-only";

import { safeDownloadFilename } from "@/lib/security-policy";

export function attachmentResponse(source: Response, filename: string) {
  const length = source.headers.get("content-length");
  return new Response(source.body, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeDownloadFilename(filename)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...(length && /^\d+$/.test(length) ? { "Content-Length": length } : {}),
    },
  });
}
