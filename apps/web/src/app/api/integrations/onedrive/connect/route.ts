import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { canManageIntegrations, getIntegrationRequestUser } from "@/lib/integration-access";
import { createOneDriveAuthorization, oneDriveAppUrl, oneDriveOAuthCookieName, oneDriveConfigurationStatus } from "@/lib/onedrive";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const locale = request.nextUrl.searchParams.get("lang") === "ar" ? "ar" : "en";
  const user = await getIntegrationRequestUser(request.headers);
  if (!user) return NextResponse.redirect(oneDriveAppUrl(`/${locale}/sign-in`));
  if (!canManageIntegrations(user)) {
    return NextResponse.redirect(oneDriveAppUrl(`/${locale}?error=${encodeURIComponent(locale === "ar" ? "ليس لديك صلاحية لإدارة التكاملات." : "You do not have permission to manage integrations.")}`));
  }
  if (!oneDriveConfigurationStatus().configured) {
    return NextResponse.redirect(oneDriveAppUrl(`/${locale}/integrations/onedrive?error=${encodeURIComponent(locale === "ar" ? "إعدادات Microsoft غير مكتملة." : "Microsoft configuration is incomplete.")}`));
  }

  const authorization = createOneDriveAuthorization(locale, user.id, user.organizationId!);
  const response = NextResponse.redirect(authorization.authorizationUrl);
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set({
    name: oneDriveOAuthCookieName,
    value: authorization.cookieValue,
    httpOnly: true,
    secure: oneDriveAppUrl("/").protocol === "https:",
    sameSite: "lax",
    path: "/api/integrations/onedrive/callback",
    maxAge: 10 * 60,
  });
  return response;
}
