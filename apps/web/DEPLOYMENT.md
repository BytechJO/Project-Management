# Bytech Project Management Tracker — Production Deployment

This package contains application source and database migrations only. It does not contain local `.env` files, passwords, build caches, logs, dependencies, or business records.

## 1. Production requirements

- Node.js 24.18 LTS (the version pinned by `.nvmrc` and `netlify.toml`)
- pnpm 11
- A production PostgreSQL database with TLS enabled
- An HTTPS domain for the application

## 2. Configure secrets

Copy `.env.example` into the hosting provider's environment-variable settings. Do not commit a real `.env` file.

Required values:

- `DATABASE_URL`: production PostgreSQL connection URL
- `BETTER_AUTH_SECRET`: a new random secret of at least 32 characters
- `BETTER_AUTH_URL`: the public HTTPS application URL
- `BOOTSTRAP_ADMIN_EMAIL`: initial administrator email
- `BOOTSTRAP_ADMIN_PASSWORD`: a unique strong password of at least 12 characters
- `BOOTSTRAP_ADMIN_NAME`: initial administrator name

OneDrive values are optional until the integration is enabled:

- `MICROSOFT_TENANT_ID`
- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_REDIRECT_URI=https://YOUR-DOMAIN/api/integrations/onedrive/callback`
- `ONEDRIVE_TOKEN_ENCRYPTION_KEY`: a separate new random secret of at least 32 characters

The production callback URL must also be registered in Microsoft Entra. Do not reuse local secrets in production.

## 3. Install, migrate, and seed

Run these commands from the application directory:

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm prisma generate
pnpm prisma migrate deploy
pnpm prisma db seed
pnpm run build
pnpm run start
```

The production seed is idempotent and creates only:

- the Bytech organization and work schedule;
- system roles and permissions;
- the administrator configured through the environment variables.

It does not create departments, employees, clients, projects, tasks, hours, expenses, invoices, quotations, subscriptions, notifications, or sample data.

## 4. First login

Sign in with `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD`, then change the deployment password according to the company's credential policy. Create departments and employees from the empty workspace.

OneDrive must be connected again from the deployed application because local connection tokens are intentionally excluded.

## 5. Production checks

- Configure the container or uptime monitor to call `GET /api/health`; HTTP `200` means the application and database are ready, while `503` means the database is unavailable.
- Collect the container's standard output as JSON logs. Unexpected requests and Server Action failures are logged with secret redaction and without exposing details to users.
- Force HTTPS and configure the reverse proxy to preserve the original host and protocol.
- Restrict database access to the application network and require TLS.
- Keep database backups and test restore procedures.
- Store environment variables in the hosting provider's secret manager.
- Confirm Microsoft Entra uses the exact production callback URL.
- Run `pnpm run test:security` after dependency or authentication changes.

## Local clean-copy command

The repository includes a guarded local-only cleanup command. It refuses non-local database hosts and requires an explicit confirmation value:

```powershell
$env:CLEAN_DATABASE_CONFIRMATION="CLEAN_BYTECH_DATABASE"
pnpm run db:prepare-clean-deployment
```

This command permanently deletes local business records while preserving the configured administrator. It removes the OneDrive connection record but never deletes files stored in OneDrive.

For Netlify, follow [NETLIFY_DEPLOYMENT.md](./NETLIFY_DEPLOYMENT.md). Do not use Netlify Drop for this application because it uses dynamic Next.js server features.
