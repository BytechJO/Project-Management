import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

const projectRoot = process.cwd();
const baseURL = new URL(process.env.SECURITY_TEST_BASE_URL ?? "http://127.0.0.1:3000");
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

if (!localHosts.has(baseURL.hostname)) {
  throw new Error("Refusing to run security tests against a non-local URL.");
}

let appServer: ChildProcess | null = null;
let serverOutput = "";

async function probeApplication() {
  try {
    const response = await fetch(new URL("/en/sign-in", baseURL), {
      redirect: "manual",
      signal: AbortSignal.timeout(2_000),
    });
    const body = await response.text();
    return response.status === 200 && body.includes("Bytech Project Management");
  } catch {
    return false;
  }
}

async function waitForApplication() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await probeApplication()) return;
    if (appServer?.exitCode != null) {
      throw new Error(`The local application server stopped before becoming ready.\n${serverOutput}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`The local application server did not become ready.\n${serverOutput}`);
}

async function startApplicationIfNeeded() {
  if (await probeApplication()) return;

  const port = baseURL.port || "3000";
  const hostname = baseURL.hostname === "localhost" ? "127.0.0.1" : baseURL.hostname;
  const nextBin = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");

  appServer = spawn(
    process.execPath,
    [nextBin, "dev", "--hostname", hostname, "--port", port],
    {
      cwd: projectRoot,
      env: { ...process.env, BETTER_AUTH_URL: baseURL.origin },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  const rememberOutput = (chunk: Buffer) => {
    serverOutput = `${serverOutput}${chunk.toString()}`.slice(-12_000);
  };
  appServer.stdout?.on("data", rememberOutput);
  appServer.stderr?.on("data", rememberOutput);

  await waitForApplication();
}

async function runTests() {
  const tsxCli = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const testFiles = [
    path.join("tests", "security", "policies.test.ts"),
    path.join("tests", "security", "http.test.ts"),
  ];
  const child = spawn(
    process.execPath,
    [tsxCli, "--test", "--test-concurrency=1", ...testFiles],
    {
      cwd: projectRoot,
      env: { ...process.env, SECURITY_TEST_BASE_URL: baseURL.origin },
      stdio: "inherit",
      windowsHide: true,
    },
  );

  return new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function stopApplication() {
  if (!appServer?.pid || appServer.exitCode != null) return;

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(appServer!.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("error", () => resolve());
      killer.once("exit", () => resolve());
    });
  } else {
    appServer.kill("SIGTERM");
  }
}

async function main() {
  let exitCode = 1;
  try {
    await startApplicationIfNeeded();
    exitCode = await runTests();
  } finally {
    await stopApplication();
  }

  process.exitCode = exitCode;
}

void main();
