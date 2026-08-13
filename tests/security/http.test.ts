import assert from "node:assert/strict";
import { describe, test } from "node:test";

const baseURL = new URL(process.env.SECURITY_TEST_BASE_URL ?? "http://127.0.0.1:3000");
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

if (!localHosts.has(baseURL.hostname)) {
  throw new Error("Security HTTP tests can run only against a local application server.");
}

function appURL(pathname: string) {
  return new URL(pathname, baseURL).toString();
}

describe("unauthenticated page access", () => {
  for (const [path, expectedSignIn] of [
    ["/en", "/en/sign-in"],
    ["/en/employees", "/en/sign-in"],
    ["/en/financials", "/en/sign-in"],
    ["/en/leave", "/en/sign-in"],
    ["/en/resource-planning", "/en/sign-in"],
    ["/en/activity", "/en/sign-in"],
    ["/en/integrations/onedrive", "/en/sign-in"],
    ["/en/profile", "/en/sign-in"],
    ["/ar", "/ar/sign-in"],
  ] as const) {
    test(`${path} redirects to its localized sign-in page`, async () => {
      const response = await fetch(appURL(path), { redirect: "manual", cache: "no-store" });
      assert.ok([303, 307, 308].includes(response.status), `Expected a redirect, received ${response.status}`);
      assert.equal(new URL(response.headers.get("location")!, baseURL).pathname, expectedSignIn);
    });
  }
});

describe("document API authentication", () => {
  for (const path of [
    "/api/documents/invoices/security-test-id?download=1",
    "/api/documents/quotations/security-test-id?download=1",
    "/api/documents/payments/security-test-id?download=1",
    "/api/documents/clients/security-test-id/statement?download=1",
    "/api/documents/projects/security-test-id/profitability/pdf?download=1",
    "/api/documents/projects/security-test-id/profitability/excel?download=1",
    "/api/documents/reports/hours/pdf?month=2026-08",
    "/api/documents/reports/hours/excel?month=2026-08",
    "/api/attachments/projects/security-test-id",
    "/api/attachments/tasks/security-test-id",
  ]) {
    test(`${path} returns 401 before resource lookup`, async () => {
      const response = await fetch(appURL(path), { redirect: "manual", cache: "no-store" });
      assert.equal(response.status, 401);
      assert.equal(await response.text(), "Authentication required.");
      assert.equal(response.headers.get("content-type")?.includes("application/pdf") ?? false, false);
    });
  }
});

describe("notification API authentication", () => {
  test("returns 401 before querying account notifications", async () => {
    const response = await fetch(appURL("/api/notifications?lang=en"), { redirect: "manual", cache: "no-store" });
    assert.equal(response.status, 401);
    assert.equal(await response.text(), "Authentication required.");
  });
});

describe("OneDrive integration authentication", () => {
  test("connect redirects unauthenticated users to sign in before starting Microsoft OAuth", async () => {
    const response = await fetch(appURL("/api/integrations/onedrive/connect?lang=en"), { redirect: "manual", cache: "no-store" });
    assert.ok([303, 307, 308].includes(response.status));
    assert.equal(new URL(response.headers.get("location")!, baseURL).pathname, "/en/sign-in");
  });
});

describe("authentication and response hardening", () => {
  test("an unauthenticated session endpoint returns no user data", async () => {
    const response = await fetch(appURL("/api/auth/get-session"), { cache: "no-store" });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "null");
  });

  test("security headers are present and framework disclosure is disabled", async () => {
    const response = await fetch(appURL("/en/sign-in"), { cache: "no-store" });
    assert.equal(response.status, 200);
    const contentSecurityPolicy = response.headers.get("content-security-policy") ?? "";
    assert.match(contentSecurityPolicy, /default-src 'self'/);
    assert.match(contentSecurityPolicy, /frame-ancestors 'none'/);
    assert.match(contentSecurityPolicy, /object-src 'none'/);
    assert.match(contentSecurityPolicy, /connect-src 'self'/);
    assert.match(contentSecurityPolicy, /img-src 'self' data: blob:/);
    assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
    assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.equal(response.headers.get("origin-agent-cluster"), "?1");
    assert.equal(response.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=(), browsing-topics=()");
    assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-dns-prefetch-control"), "off");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("x-powered-by"), null);
  });
});
