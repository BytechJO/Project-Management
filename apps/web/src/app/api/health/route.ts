import { errorLogMessage } from "@/lib/log-safety";
import { prisma } from "@/lib/prisma";
import { logServerEvent } from "@/lib/server-log";

export const runtime = "nodejs";

const responseHeaders = {
  "Cache-Control": "no-store, max-age=0",
};
let lastFailureLogAt = 0;

async function checkDatabase() {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Database health check timed out.")), 2_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function GET() {
  const startedAt = performance.now();

  try {
    await checkDatabase();
    return Response.json({
      status: "ok",
      service: "bytech-project-management",
      checks: { database: "ok" },
      responseTimeMs: Math.round(performance.now() - startedAt),
    }, { headers: responseHeaders });
  } catch (error) {
    const now = Date.now();
    if (now - lastFailureLogAt >= 60_000) {
      lastFailureLogAt = now;
      logServerEvent("warn", "health_check_failed", {
        check: "database",
        message: errorLogMessage(error),
      });
    }

    return Response.json({
      status: "unavailable",
      service: "bytech-project-management",
      checks: { database: "unavailable" },
      responseTimeMs: Math.round(performance.now() - startedAt),
    }, { status: 503, headers: responseHeaders });
  }
}
