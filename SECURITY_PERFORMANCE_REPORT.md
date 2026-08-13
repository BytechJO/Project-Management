# Security and Performance Audit

Audit date: 2026-08-13

Scope: the complete Bytech Project Management web application source, production dependency tree, authentication and authorization policies, HTTP security controls, production build, and the public sign-in route in a production-like local server.

## Executive result

- Production dependency audit: **0 known vulnerabilities** (info, low, moderate, high, and critical all zero).
- Security test suite: **58/58 tests passed**, covering authorization, resource scoping, protected routes, safe errors, documents, attachments, OneDrive encryption, and security headers.
- Production build: successful across all 54 generated routes.
- Lighthouse mobile: Performance **97**, Accessibility **100**, Best Practices **100**, SEO **100**.
- Lighthouse desktop: Performance **100**, Accessibility **100**, Best Practices **100**, SEO **100**.

## Security findings and controls

### Dependency remediation

The indirect legacy `uuid` dependency used through `exceljs` was overridden to `11.1.1`, resolving the only moderate production advisory. The final `pnpm audit --prod` result is clean.

### Authentication

- Public registration is disabled; administrators create users.
- Password length is restricted to 12–128 characters and credentials are hashed by Better Auth.
- Sign-in is rate-limited to five attempts per minute.
- Production cookies require HTTPS, inactive users are blocked, and password changes revoke existing sessions.
- Trusted-origin configuration uses the exact `BETTER_AUTH_URL` value.

### Authorization and data isolation

- Server Actions validate sessions and permissions on the server; page visibility is not treated as authorization.
- Organization and resource scope checks cover projects, tasks, employees, clients, time entries, finance records, and documents.
- Employees see only assigned projects/tasks and their own time data.
- Project managers cannot approve their own timesheets.
- Permanent deletion requires the separate admin-only `records.delete` permission.
- Sensitive mutations are audit logged without writing passwords or secret values.

### Browser and transport hardening

Production responses set Content Security Policy, HSTS, clickjacking protection, MIME sniffing protection, restrictive referrer and permissions policies, cross-origin isolation headers, and an origin agent cluster. The CSP blocks object/embed and frame content and upgrades insecure production requests.

### Secrets and deployment package

- Local `.env` files, logs, build caches, dependencies, temporary reports, and database data are excluded from the deployment archive.
- The included environment files contain placeholders only.
- OneDrive refresh/access tokens are encrypted at rest; local connection records are not included in the clean database.

## Performance measurements

The Lighthouse tests used the optimized production build with mobile and desktop profiles.

| Metric | Mobile | Desktop |
| --- | ---: | ---: |
| Performance score | 97 | 100 |
| First Contentful Paint | 0.9 s | 0.3 s |
| Largest Contentful Paint | 2.6 s | 0.5 s |
| Total Blocking Time | 20 ms | 0 ms |
| Cumulative Layout Shift | 0 | 0 |
| Speed Index | 0.9 s | 0.3 s |
| Transfer size | 293 KiB | 290 KiB |

The remaining mobile cost is primarily simulated network/server latency, locally hosted fonts, and shared Next.js framework JavaScript. No application-specific performance regression requiring a code change was identified. Authenticated pages intentionally use non-cacheable responses to prevent personalized data from being shared between users.

Authenticated production-server checks also returned HTTP 200 for the main operational pages. On the second local pass, server response times were: Dashboard 830 ms, Projects 343 ms, Employees 334 ms, Financials 469 ms, and Hours report 393 ms. These are local application/server timings rather than real-user network measurements; production database region and serverless cold starts will affect the deployed result.

## Operational recommendations

- Use Node.js 22.12 and the frozen pnpm lockfile.
- Use managed PostgreSQL with TLS, a pooled connection URL, and `DATABASE_POOL_SIZE=1` on Netlify.
- Store secrets only in Netlify environment variables with Builds and Functions scope.
- Keep automated dependency auditing and security tests in the release process.
- Add field monitoring for Core Web Vitals and application errors after production traffic begins.
- Schedule database backups and perform restore tests.

This review is an application security audit and automated verification, not a substitute for an independent penetration test against the final production infrastructure.
