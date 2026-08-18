import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { safeAttachmentName } from "@/lib/attachment-policy";
import { decryptOneDriveJson, decryptOneDriveValue, encryptOneDriveJson, encryptOneDriveValue } from "@/lib/onedrive-crypto";
import { prisma } from "@/lib/prisma";

export const oneDriveOAuthCookieName = "bytech_onedrive_oauth";
export const oneDriveRootFolderName = "Bytech Project Management";

const graphBaseUrl = "https://graph.microsoft.com/v1.0";
const scopes = ["openid", "profile", "offline_access", "User.Read", "Files.ReadWrite"];

type OneDriveConfiguration = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: string;
  appBaseUrl: string;
};

type OAuthTransaction = {
  state: string;
  verifier: string;
  userId: string;
  organizationId: string;
  locale: "en" | "ar";
  expiresAt: number;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
};

export type OneDriveAccount = {
  id: string;
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
};

export type OneDriveDrive = {
  id: string;
  driveType?: string;
};

export type OneDriveItem = {
  id: string;
  name: string;
  webUrl?: string;
  size?: number;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
};

type OneDriveFolderTarget = {
  id: string;
  code: string;
  name: string;
  oneDriveFolderId: string | null;
};

type OneDriveTaskFolderTarget = {
  id: string;
  title: string;
  oneDriveFolderId: string | null;
};

function validHttpUrl(value: string, allowLocalHttp: boolean) {
  try {
    const parsed = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    return parsed.protocol === "https:" || (allowLocalHttp && local && parsed.protocol === "http:");
  } catch {
    return false;
  }
}

export function oneDriveConfigurationStatus() {
  const values = {
    MICROSOFT_TENANT_ID: process.env.MICROSOFT_TENANT_ID?.trim() ?? "",
    MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID?.trim() ?? "",
    MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET?.trim() ?? "",
    MICROSOFT_REDIRECT_URI: process.env.MICROSOFT_REDIRECT_URI?.trim() ?? "",
    ONEDRIVE_TOKEN_ENCRYPTION_KEY: process.env.ONEDRIVE_TOKEN_ENCRYPTION_KEY ?? "",
  };
  const missing = Object.entries(values).filter(([, value]) => !value).map(([key]) => key);
  if (values.ONEDRIVE_TOKEN_ENCRYPTION_KEY && values.ONEDRIVE_TOKEN_ENCRYPTION_KEY.length < 32) {
    missing.push("ONEDRIVE_TOKEN_ENCRYPTION_KEY (minimum 32 characters)");
  }
  if (values.MICROSOFT_REDIRECT_URI && !validHttpUrl(values.MICROSOFT_REDIRECT_URI, true)) {
    missing.push("MICROSOFT_REDIRECT_URI (must use HTTPS, or HTTP on localhost)");
  }

  const baseUrl = process.env.BETTER_AUTH_URL?.trim() ?? "";
  if (!baseUrl || !validHttpUrl(baseUrl, true)) missing.push("BETTER_AUTH_URL");
  if (values.MICROSOFT_REDIRECT_URI && baseUrl) {
    try {
      if (new URL(values.MICROSOFT_REDIRECT_URI).origin !== new URL(baseUrl).origin) {
        missing.push("MICROSOFT_REDIRECT_URI (must match the application origin)");
      }
    } catch {
      // The invalid values are already reported above.
    }
  }

  return {
    configured: missing.length === 0,
    missing: [...new Set(missing)],
    redirectUri: values.MICROSOFT_REDIRECT_URI,
  };
}

export function requireOneDriveConfiguration(): OneDriveConfiguration {
  const status = oneDriveConfigurationStatus();
  if (!status.configured) throw new Error("OneDrive integration is not configured.");
  return {
    tenantId: process.env.MICROSOFT_TENANT_ID!.trim(),
    clientId: process.env.MICROSOFT_CLIENT_ID!.trim(),
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET!.trim(),
    redirectUri: process.env.MICROSOFT_REDIRECT_URI!.trim(),
    encryptionKey: process.env.ONEDRIVE_TOKEN_ENCRYPTION_KEY!,
    appBaseUrl: process.env.BETTER_AUTH_URL!.trim(),
  };
}

function microsoftEndpoint(configuration: OneDriveConfiguration, endpoint: "authorize" | "token") {
  return `https://login.microsoftonline.com/${encodeURIComponent(configuration.tenantId)}/oauth2/v2.0/${endpoint}`;
}

function codeChallenge(verifier: string) {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

export function createOneDriveAuthorization(locale: "en" | "ar", userId: string, organizationId: string) {
  const configuration = requireOneDriveConfiguration();
  const transaction: OAuthTransaction = {
    state: randomBytes(32).toString("base64url"),
    verifier: randomBytes(64).toString("base64url"),
    userId,
    organizationId,
    locale,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  const query = new URLSearchParams({
    client_id: configuration.clientId,
    response_type: "code",
    redirect_uri: configuration.redirectUri,
    response_mode: "query",
    scope: scopes.join(" "),
    state: transaction.state,
    code_challenge: codeChallenge(transaction.verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return {
    authorizationUrl: `${microsoftEndpoint(configuration, "authorize")}?${query.toString()}`,
    cookieValue: encryptOneDriveJson(transaction, configuration.encryptionKey),
  };
}

export function readOneDriveAuthorization(cookieValue: string) {
  const configuration = requireOneDriveConfiguration();
  const transaction = decryptOneDriveJson<OAuthTransaction>(cookieValue, configuration.encryptionKey);
  if (
    !transaction.state
    || !transaction.verifier
    || !transaction.userId
    || !transaction.organizationId
    || !["en", "ar"].includes(transaction.locale)
    || !Number.isFinite(transaction.expiresAt)
    || transaction.expiresAt < Date.now()
  ) {
    throw new Error("Invalid OneDrive authorization session.");
  }
  return transaction;
}

async function tokenRequest(parameters: URLSearchParams) {
  const configuration = requireOneDriveConfiguration();
  const response = await fetch(microsoftEndpoint(configuration, "token"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: parameters,
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Microsoft authorization could not be completed.");
  const token = await response.json() as Partial<TokenResponse>;
  if (!token.access_token || !Number.isFinite(token.expires_in)) {
    throw new Error("Microsoft returned an invalid authorization response.");
  }
  return token as TokenResponse;
}

export async function exchangeOneDriveAuthorizationCode(code: string, verifier: string) {
  const configuration = requireOneDriveConfiguration();
  return tokenRequest(new URLSearchParams({
    client_id: configuration.clientId,
    client_secret: configuration.clientSecret,
    code,
    code_verifier: verifier,
    redirect_uri: configuration.redirectUri,
    grant_type: "authorization_code",
    scope: scopes.join(" "),
  }));
}

async function refreshOneDriveAccessToken(refreshToken: string) {
  const configuration = requireOneDriveConfiguration();
  return tokenRequest(new URLSearchParams({
    client_id: configuration.clientId,
    client_secret: configuration.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: scopes.join(" "),
  }));
}

function graphError(status: number) {
  if (status === 401) return "OneDrive connection has expired. Please reconnect it.";
  if (status === 403) return "OneDrive permission was denied by Microsoft.";
  if (status === 404) return "OneDrive folder could not be found.";
  if (status === 429) return "OneDrive is temporarily rate limiting requests. Please try again.";
  return "OneDrive could not complete the request.";
}

async function graphRequest<T>(accessToken: string, path: string, init: RequestInit | undefined, allowNotFound: true): Promise<T | null>;
async function graphRequest<T>(accessToken: string, path: string, init?: RequestInit, allowNotFound?: false): Promise<T>;
async function graphRequest<T>(accessToken: string, path: string, init?: RequestInit, allowNotFound = false): Promise<T | null> {
  const response = await fetch(`${graphBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) throw new Error(graphError(response.status));
  return await response.json() as T;
}

async function graphFileResponse(accessToken: string, path: string, init?: RequestInit) {
  const response = await fetch(`${graphBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(graphError(response.status));
  return response;
}

export async function getOneDriveAccount(accessToken: string) {
  return graphRequest<OneDriveAccount>(accessToken, "/me?$select=id,displayName,mail,userPrincipalName");
}

export async function getOneDriveDrive(accessToken: string) {
  return graphRequest<OneDriveDrive>(accessToken, "/me/drive?$select=id,driveType");
}

export async function ensureOneDriveRootFolder(accessToken: string) {
  const encodedName = encodeURIComponent(oneDriveRootFolderName);
  const existing = await graphRequest<OneDriveItem>(accessToken, `/me/drive/root:/${encodedName}?$select=id,name,webUrl,folder`, undefined, true);
  if (existing) return existing;

  try {
    return await graphRequest<OneDriveItem>(accessToken, "/me/drive/root/children", {
      method: "POST",
      body: JSON.stringify({
        name: oneDriveRootFolderName,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail",
      }),
    });
  } catch (error) {
    const racedFolder = await graphRequest<OneDriveItem>(accessToken, `/me/drive/root:/${encodedName}?$select=id,name,webUrl,folder`, undefined, true);
    if (racedFolder) return racedFolder;
    throw error;
  }
}

export function protectOneDriveRefreshToken(refreshToken: string) {
  return encryptOneDriveValue(refreshToken, requireOneDriveConfiguration().encryptionKey);
}

export function oneDriveAccessTokenExpiry(expiresIn: number) {
  return new Date(Date.now() + Math.max(0, expiresIn - 60) * 1000);
}

export async function getStoredOneDriveAccess(organizationId: string) {
  const connection = await prisma.oneDriveConnection.findUnique({ where: { organizationId } });
  if (!connection) throw new Error("OneDrive is not connected.");
  const configuration = requireOneDriveConfiguration();

  try {
    const currentRefreshToken = decryptOneDriveValue(connection.encryptedRefreshToken, configuration.encryptionKey);
    const token = await refreshOneDriveAccessToken(currentRefreshToken);
    const updatedConnection = await prisma.oneDriveConnection.update({
      where: { organizationId },
      data: {
        encryptedRefreshToken: token.refresh_token
          ? protectOneDriveRefreshToken(token.refresh_token)
          : connection.encryptedRefreshToken,
        grantedScopes: token.scope ?? connection.grantedScopes,
        accessTokenExpiresAt: oneDriveAccessTokenExpiry(token.expires_in),
        lastVerifiedAt: new Date(),
        lastError: null,
      },
    });
    return { accessToken: token.access_token, connection: updatedConnection };
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("OneDrive ")
      ? error.message.slice(0, 220)
      : "OneDrive connection verification failed.";
    await prisma.oneDriveConnection.update({
      where: { organizationId },
      data: { lastError: message },
    });
    throw new Error(message);
  }
}

function safeFolderName(value: string, fallback: string) {
  const safe = safeAttachmentName(value).slice(0, 120);
  return safe || fallback;
}

async function getDriveFolder(accessToken: string, driveId: string, itemId: string) {
  const item = await graphRequest<OneDriveItem>(
    accessToken,
    `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}?$select=id,name,webUrl,folder`,
    undefined,
    true,
  );
  return item?.folder ? item : null;
}

async function ensureChildFolder(accessToken: string, driveId: string, parentItemId: string, requestedName: string) {
  const name = safeFolderName(requestedName, "Files");
  const relativePath = `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentItemId)}:/${encodeURIComponent(name)}?$select=id,name,webUrl,folder`;
  const existing = await graphRequest<OneDriveItem>(accessToken, relativePath, undefined, true);
  if (existing?.folder) return existing;

  try {
    return await graphRequest<OneDriveItem>(
      accessToken,
      `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentItemId)}/children`,
      {
        method: "POST",
        body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
      },
    );
  } catch (error) {
    const racedFolder = await graphRequest<OneDriveItem>(accessToken, relativePath, undefined, true);
    if (racedFolder?.folder) return racedFolder;
    throw error;
  }
}

async function ensureProjectFolder(
  accessToken: string,
  driveId: string,
  rootItemId: string,
  project: OneDriveFolderTarget,
) {
  if (project.oneDriveFolderId) {
    const storedFolder = await getDriveFolder(accessToken, driveId, project.oneDriveFolderId);
    if (storedFolder) return storedFolder;
  }

  const projectsFolder = await ensureChildFolder(accessToken, driveId, rootItemId, "Projects");
  const projectFolder = await ensureChildFolder(accessToken, driveId, projectsFolder.id, `${project.code} - ${project.name}`);
  await prisma.project.update({ where: { id: project.id }, data: { oneDriveFolderId: projectFolder.id } });
  return projectFolder;
}

async function ensureTaskFolder(
  accessToken: string,
  driveId: string,
  projectFolderId: string,
  task: OneDriveTaskFolderTarget,
) {
  if (task.oneDriveFolderId) {
    const storedFolder = await getDriveFolder(accessToken, driveId, task.oneDriveFolderId);
    if (storedFolder) return storedFolder;
  }

  const tasksFolder = await ensureChildFolder(accessToken, driveId, projectFolderId, "Tasks");
  const taskFolder = await ensureChildFolder(accessToken, driveId, tasksFolder.id, `${task.title} - ${task.id.slice(-8)}`);
  await prisma.task.update({ where: { id: task.id }, data: { oneDriveFolderId: taskFolder.id } });
  return taskFolder;
}

async function uploadFile(
  accessToken: string,
  driveId: string,
  parentItemId: string,
  name: string,
  mimeType: string,
  bytes: Uint8Array,
) {
  const uniqueName = `${new Date().toISOString().replace(/[:.]/g, "-")} - ${randomBytes(3).toString("hex")} - ${safeAttachmentName(name)}`;
  const response = await graphFileResponse(
    accessToken,
    `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentItemId)}:/${encodeURIComponent(uniqueName)}:/content`,
    { method: "PUT", headers: { "Content-Type": mimeType }, body: bytes as BodyInit },
  );
  const item = await response.json() as OneDriveItem;
  if (!item.id || !item.webUrl) throw new Error("OneDrive returned incomplete file details.");
  return item;
}

export async function uploadProjectFileToOneDrive(options: {
  organizationId: string;
  project: OneDriveFolderTarget;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}) {
  const { accessToken, connection } = await getStoredOneDriveAccess(options.organizationId);
  const projectFolder = await ensureProjectFolder(
    accessToken,
    connection.driveId,
    connection.rootItemId,
    options.project,
  );
  return uploadFile(accessToken, connection.driveId, projectFolder.id, options.name, options.mimeType, options.bytes);
}

export async function uploadTaskFileToOneDrive(options: {
  organizationId: string;
  project: OneDriveFolderTarget;
  task: OneDriveTaskFolderTarget;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}) {
  const { accessToken, connection } = await getStoredOneDriveAccess(options.organizationId);
  const projectFolder = await ensureProjectFolder(
    accessToken,
    connection.driveId,
    connection.rootItemId,
    options.project,
  );
  const taskFolder = await ensureTaskFolder(accessToken, connection.driveId, projectFolder.id, options.task);
  return uploadFile(accessToken, connection.driveId, taskFolder.id, options.name, options.mimeType, options.bytes);
}

export async function downloadOneDriveFile(organizationId: string, itemId: string) {
  const { accessToken, connection } = await getStoredOneDriveAccess(organizationId);
  return graphFileResponse(
    accessToken,
    `/drives/${encodeURIComponent(connection.driveId)}/items/${encodeURIComponent(itemId)}/content`,
  );
}

export async function verifyStoredOneDriveConnection(organizationId: string) {
  const { accessToken, connection } = await getStoredOneDriveAccess(organizationId);
  try {
    const [drive, rootItem] = await Promise.all([
      getOneDriveDrive(accessToken),
      graphRequest<OneDriveItem>(accessToken, `/drives/${encodeURIComponent(connection.driveId)}/items/${encodeURIComponent(connection.rootItemId)}?$select=id,name,webUrl,folder`),
    ]);
    if (drive.id !== connection.driveId || !rootItem.folder) {
      throw new Error("OneDrive connection points to an invalid storage folder.");
    }

    return prisma.oneDriveConnection.update({
      where: { organizationId },
      data: {
        lastVerifiedAt: new Date(),
        lastError: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("OneDrive ")
      ? error.message.slice(0, 220)
      : "OneDrive connection verification failed.";
    await prisma.oneDriveConnection.update({
      where: { organizationId },
      data: { lastError: message },
    });
    throw new Error(message);
  }
}

export function oneDriveAppUrl(path: string) {
  const baseUrl = process.env.BETTER_AUTH_URL?.trim();
  if (!baseUrl || !validHttpUrl(baseUrl, true)) throw new Error("Application URL is not configured.");
  return new URL(path, baseUrl);
}
