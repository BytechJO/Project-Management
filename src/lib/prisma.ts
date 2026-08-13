import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

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
    onConnectionError: (error) => console.warn("[database] Connection error:", error.message),
    onPoolError: (error) => console.warn("[database] Pool error:", error.message),
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

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
