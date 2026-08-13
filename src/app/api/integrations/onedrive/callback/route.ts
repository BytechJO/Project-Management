import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { canManageIntegrations, getIntegrationRequestUser } from "@/lib/integration-access";
import {
  ensureOneDriveRootFolder,
  exchangeOneDriveAuthorizationCode,
  getOneDriveAccount,
  getOneDriveDrive,
  oneDriveAccessTokenExpiry,
  oneDriveAppUrl,
  oneDriveOAuthCookieName,
  oneDriveRootFolderName,
  protectOneDriveRefreshToken,
  readOneDriveAuthorization,
} from "@/lib/onedrive";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function finish(path: string) {
  const response = NextResponse.redirect(oneDriveAppUrl(path));
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set({
    name: oneDriveOAuthCookieName,
    value: "",
    httpOnly: true,
    secure: oneDriveAppUrl("/").protocol === "https:",
    sameSite: "lax",
    path: "/api/integrations/onedrive/callback",
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  const cookieValue = request.cookies.get(oneDriveOAuthCookieName)?.value;
  if (!cookieValue) return finish("/en/integrations/onedrive?error=Microsoft%20authorization%20session%20expired.");

  let transaction;
  try {
    transaction = readOneDriveAuthorization(cookieValue);
  } catch {
    return finish("/en/integrations/onedrive?error=Microsoft%20authorization%20session%20expired.");
  }

  const destination = `/${transaction.locale}/integrations/onedrive`;
  const returnedState = request.nextUrl.searchParams.get("state") ?? "";
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const microsoftError = request.nextUrl.searchParams.get("error");

  if (microsoftError) {
    return finish(`${destination}?error=${encodeURIComponent(transaction.locale === "ar" ? "تم إلغاء ربط Microsoft." : "Microsoft connection was cancelled.")}`);
  }
  if (returnedState !== transaction.state || !code || code.length > 4096) {
    return finish(`${destination}?error=${encodeURIComponent(transaction.locale === "ar" ? "فشل التحقق من طلب الربط." : "The connection request could not be verified.")}`);
  }

  const user = await getIntegrationRequestUser(request.headers);
  if (
    !user
    || !canManageIntegrations(user)
    || user.id !== transaction.userId
    || user.organizationId !== transaction.organizationId
  ) {
    return finish(`${destination}?error=${encodeURIComponent(transaction.locale === "ar" ? "انتهت جلسة المستخدم أو تغيرت." : "The user session expired or changed.")}`);
  }

  try {
    const token = await exchangeOneDriveAuthorizationCode(code, transaction.verifier);
    if (!token.refresh_token) throw new Error("Microsoft did not provide offline access.");
    const [account, drive] = await Promise.all([
      getOneDriveAccount(token.access_token),
      getOneDriveDrive(token.access_token),
    ]);
    const rootFolder = await ensureOneDriveRootFolder(token.access_token);
    const accountEmail = account.mail?.trim() || account.userPrincipalName?.trim();
    if (!account.id || !drive.id || !rootFolder.id || !accountEmail) {
      throw new Error("Microsoft returned incomplete OneDrive account details.");
    }

    await prisma.$transaction(async (database) => {
      const connection = await database.oneDriveConnection.upsert({
        where: { organizationId: user.organizationId! },
        update: {
          connectedById: user.id,
          tenantId: process.env.MICROSOFT_TENANT_ID!.trim(),
          microsoftUserId: account.id,
          accountEmail,
          accountDisplayName: account.displayName?.trim() || null,
          driveId: drive.id,
          rootItemId: rootFolder.id,
          rootFolderName: rootFolder.name || oneDriveRootFolderName,
          encryptedRefreshToken: protectOneDriveRefreshToken(token.refresh_token!),
          grantedScopes: token.scope ?? "Files.ReadWrite User.Read offline_access",
          accessTokenExpiresAt: oneDriveAccessTokenExpiry(token.expires_in),
          lastVerifiedAt: new Date(),
          lastError: null,
        },
        create: {
          organizationId: user.organizationId!,
          connectedById: user.id,
          tenantId: process.env.MICROSOFT_TENANT_ID!.trim(),
          microsoftUserId: account.id,
          accountEmail,
          accountDisplayName: account.displayName?.trim() || null,
          driveId: drive.id,
          rootItemId: rootFolder.id,
          rootFolderName: rootFolder.name || oneDriveRootFolderName,
          encryptedRefreshToken: protectOneDriveRefreshToken(token.refresh_token!),
          grantedScopes: token.scope ?? "Files.ReadWrite User.Read offline_access",
          accessTokenExpiresAt: oneDriveAccessTokenExpiry(token.expires_in),
          lastVerifiedAt: new Date(),
        },
      });
      await database.auditLog.create({
        data: {
          organizationId: user.organizationId!,
          actorId: user.id,
          action: "onedrive.connected",
          entityType: "OneDriveConnection",
          entityId: connection.id,
          after: {
            accountEmail,
            driveType: drive.driveType ?? "business",
            rootFolderName: rootFolder.name || oneDriveRootFolderName,
          },
        },
      });
    });
  } catch (error) {
    console.warn("[onedrive] Connection failed:", error instanceof Error ? error.message : "Unknown error");
    return finish(`${destination}?error=${encodeURIComponent(transaction.locale === "ar" ? "تعذر إكمال ربط OneDrive. تحقق من إعدادات Microsoft وحاول مجددًا." : "OneDrive could not be connected. Check the Microsoft configuration and try again.")}`);
  }

  return finish(`${destination}?success=${encodeURIComponent(transaction.locale === "ar" ? "تم ربط OneDrive وإنشاء مجلد الشركة بنجاح." : "OneDrive connected and the company folder was created successfully.")}`);
}
