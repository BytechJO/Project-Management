# Bytech Project Management

Internal web application for projects, employees, time tracking, approvals, and project profitability. English is the primary language; Arabic is available at `/ar` with RTL layout.

Production setup and clean-database instructions are documented in [DEPLOYMENT.md](./DEPLOYMENT.md). Netlify-specific steps are in [NETLIFY_DEPLOYMENT.md](./NETLIFY_DEPLOYMENT.md), and the latest security/performance audit is in [SECURITY_PERFORMANCE_REPORT.md](./SECURITY_PERFORMANCE_REPORT.md).

## Local setup

1. Copy `.env.example` to `.env` and replace the development secrets.
2. Start the local PostgreSQL service when setting up the project for the first time:

   ```bash
   pnpm prisma dev --name bytech-pm --detach
   ```

3. Update `DATABASE_URL` with the TCP URL printed by `prisma dev`.
4. Create the database and initial Bytech workspace:

   ```bash
   pnpm db:migrate
   pnpm db:seed
   ```

5. Start the application:

   ```bash
   pnpm dev
   ```

   The development command automatically resumes the named `bytech-pm` database before starting Next.js. You can also resume it separately with `pnpm db:start`.

Open `http://localhost:3000`. The bootstrap administrator email and password come from the `BOOTSTRAP_ADMIN_*` values in the ignored `.env` file.

## Quality checks

```bash
pnpm typecheck
pnpm lint
pnpm test:security
pnpm build
```

`pnpm test:security` checks organization and resource authorization policies, safe public error handling, protected-page redirects, document API authentication, and response security headers. It uses an already-running local app at `http://127.0.0.1:3000`, or starts and stops one automatically when needed. Set `SECURITY_TEST_BASE_URL` to another localhost URL if required; non-local targets are rejected.

## Security notes

- Public sign-up is disabled. Administrators create employee accounts from the Employees screen.
- Sign-in is rate-limited, passwords must contain at least 12 characters, and production requires HTTPS cookies.
- Password hashes and sessions are stored by Better Auth in separate authentication tables; deactivating an employee revokes their sessions.
- Protected pages and mutations perform server-side session, organization, role, permission, and resource-scope checks against PostgreSQL.
- Administrators have organization-wide access; accountants are limited to clients, projects, and finance operations.
- Permanent deletion uses the separate `records.delete` permission, assigned to the Admin role only. Connected time and financial history blocks deletion.
- Project managers can access only projects they directly manage, their project tasks and teams, and those projects' timesheet approvals.
- Employees see only assigned projects and tasks plus their own time records; client contacts see only their client's projects without internal team or financial data.
- Project managers cannot approve their own timesheets, and document downloads use the same project scope as the related page.
- One employee can have only one active timer, enforced by a PostgreSQL partial unique index.
- Security headers block framing, MIME sniffing, browser device APIs, and unsafe object/embed content.
- Replace all local secrets and the bootstrap password before any shared or production deployment.
