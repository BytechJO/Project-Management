import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

import { prisma } from "@/lib/prisma";

const baseURL = process.env.BETTER_AUTH_URL;
const secret = process.env.BETTER_AUTH_SECRET;

if (!baseURL) {
  throw new Error("BETTER_AUTH_URL is not configured.");
}

if (!secret || secret.length < 32) {
  throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.");
}

const parsedBaseURL = new URL(baseURL);
const isLocalBaseURL = ["localhost", "127.0.0.1", "[::1]"].includes(parsedBaseURL.hostname);

if (parsedBaseURL.protocol !== "https:" && !isLocalBaseURL) {
  throw new Error("BETTER_AUTH_URL must use HTTPS in production.");
}

export const auth = betterAuth({
  appName: "Bytech Project Management",
  baseURL,
  secret,
  trustedOrigins: [baseURL],
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const user = await prisma.user.findFirst({
            where: { id: session.userId, status: "ACTIVE" },
            select: { id: true },
          });
          return Boolean(user);
        },
      },
    },
  },
  advanced: {
    useSecureCookies: parsedBaseURL.protocol === "https:",
  },
  plugins: [nextCookies()],
});
