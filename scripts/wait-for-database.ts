import "dotenv/config";

import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not configured.");

async function probe() {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 1_500 });
  try {
    await pool.query("SELECT 1");
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function main() {
  const deadline = Date.now() + 20_000;
  let consecutiveSuccesses = 0;

  while (Date.now() < deadline && consecutiveSuccesses < 3) {
    try {
      await probe();
      consecutiveSuccesses += 1;
    } catch {
      consecutiveSuccesses = 0;
    }
    if (consecutiveSuccesses < 3) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  if (consecutiveSuccesses < 3) {
    throw new Error("The local database did not become ready within 20 seconds.");
  }

  console.log("Database connection is ready.");
}

void main();
