import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { logServerEvent } from "@/lib/server-log";

function createPrismaClient(connectionString: string) {
  const configuredSize = Number(process.env.DATABASE_POOL_SIZE ?? 5);
  const max = Number.isInteger(configuredSize) && configuredSize > 0
    ? Math.min(configuredSize, 20)
    : 5;
  const adapter = new PrismaPg({
    connectionString,
    max,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 300_000,
    keepAlive: true,
  }, {
    onConnectionError: (error) => logServerEvent("warn", "database_connection_error", { message: error.message }),
    onPoolError: (error) => logServerEvent("warn", "database_pool_error", { message: error.message }),
  });
  return new PrismaClient({ adapter });
}

type AppPrismaClient = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: AppPrismaClient | undefined;
};

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured.");
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient(connectionString);

// Netlify can reuse a warm Node.js function for several requests. Keep one
// client per warm runtime so repeated invocations do not create a fresh pool.
globalForPrisma.prisma = prisma;
