import type { Instrumentation } from "next";

import { errorLogMessage } from "@/lib/log-safety";
import { logServerEvent } from "@/lib/server-log";

function errorDigest(error: unknown) {
  if (typeof error !== "object" || error === null || !("digest" in error)) return undefined;
  return String(error.digest);
}

function requestHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
) {
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  const value = match?.[1];
  return Array.isArray(value) ? value[0] : value;
}

export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
  context,
) => {
  logServerEvent("error", "next_request_error", {
    errorName: error instanceof Error ? error.name : "UnknownError",
    message: errorLogMessage(error),
    digest: errorDigest(error),
    method: request.method,
    path: request.path.split(/[?#]/, 1)[0],
    route: context.routePath,
    routeType: context.routeType,
    router: context.routerKind,
    requestId: requestHeader(request.headers, "x-request-id"),
    cloudflareRay: requestHeader(request.headers, "cf-ray"),
  });
};
