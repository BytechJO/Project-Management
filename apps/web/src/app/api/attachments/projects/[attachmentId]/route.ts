import type { NextRequest } from "next/server";

import { getAttachmentRequestAccess } from "@/lib/attachment-access";
import { attachmentResponse } from "@/lib/attachment-response";
import { downloadOneDriveFile } from "@/lib/onedrive";
import { prisma } from "@/lib/prisma";
import { projectAccessScope } from "@/lib/security-policy";

export async function GET(request: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) {
  const access = await getAttachmentRequestAccess(request);
  if (!access) return new Response("Authentication required.", { status: 401 });
  if (!access.canReadProjects || !access.isInternal) return new Response("Forbidden.", { status: 403 });

  const { attachmentId } = await params;
  const attachment = await prisma.projectAttachment.findFirst({
    where: {
      id: attachmentId,
      storageProvider: "ONEDRIVE",
      oneDriveItemId: { not: null },
      project: {
        organizationId: access.user.organizationId!,
        ...projectAccessScope(access.user.id, access.projectAccessLevel, access.user.clientContact?.clientId),
      },
    },
  });
  if (!attachment?.oneDriveItemId) return new Response("Attachment not found.", { status: 404 });

  try {
    const source = await downloadOneDriveFile(access.user.organizationId!, attachment.oneDriveItemId);
    return attachmentResponse(source, attachment.name);
  } catch {
    return new Response("Attachment could not be downloaded from OneDrive.", { status: 502 });
  }
}
