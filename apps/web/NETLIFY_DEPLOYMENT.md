# Netlify Deployment Guide

This is a dynamic Next.js App Router application with authentication, Server Actions, route handlers, and PostgreSQL. Deploy the source through a connected Git repository or the Netlify CLI. Do not upload the source ZIP to Netlify Drop, which is intended for prebuilt static site files.

## 1. Prepare managed PostgreSQL

Create an external production PostgreSQL database that accepts TLS connections. Use its pooled connection URL when the provider offers one.

Run the schema migration and one-time seed from a protected administration machine before the first login:

```powershell
pnpm install --frozen-lockfile
pnpm prisma migrate deploy
pnpm prisma db seed
```

The seed is idempotent and creates the Bytech organization, system roles/permissions, and the configured administrator only. It does not create sample business records.

## 2. Configure the Netlify project

The included `netlify.toml` configures:

- build command: `pnpm run netlify:build`
- publish directory: `.next`
- Node.js: `24.18.0`
- frozen pnpm lockfile installation

In **Project configuration > Environment variables**, add every required value from `.env.netlify.example`. Give runtime values both **Builds** and **Functions** scope. Never upload `.env` or `.env.local`.

Important production values:

- `DATABASE_URL`: pooled PostgreSQL URL with TLS, for example `sslmode=require`
- `DATABASE_POOL_SIZE=1`: limits each serverless function instance's database pool
- `BETTER_AUTH_SECRET`: a new random value of at least 32 characters
- `BETTER_AUTH_URL`: the exact final HTTPS site URL
- `BOOTSTRAP_ADMIN_*`: the first administrator credentials used only by the seed
- `NETLIFY_NEXT_SKEW_PROTECTION=true`

For OneDrive, also set all `MICROSOFT_*` values and `ONEDRIVE_TOKEN_ENCRYPTION_KEY`. Register the exact production callback in Microsoft Entra:

```text
https://YOUR-DOMAIN/api/integrations/onedrive/callback
```

## 3. Deploy

Recommended Git flow:

1. Extract the clean package into a private Git repository.
2. In Netlify, choose **Add new project > Import an existing project**.
3. Select the repository and confirm the detected settings from `netlify.toml`.
4. Add the environment variables, then deploy.

CLI alternative after authenticating the Netlify CLI:

```powershell
pnpm dlx netlify-cli deploy --build --prod
```

## 4. Verify after deployment

1. Open `/en/sign-in` and sign in with the production bootstrap administrator.
2. Change the initial password from the employee edit screen.
3. Confirm `/en`, `/en/employees`, and one create/edit flow.
4. Confirm response headers include CSP, HSTS, `X-Content-Type-Options`, and frame protection.
5. Connect OneDrive again in the production application if required.
6. Create a database backup and verify the restore procedure.

If the final domain changes, update `BETTER_AUTH_URL`, `MICROSOFT_REDIRECT_URI`, and the Microsoft Entra redirect registration, then redeploy.

## Official references

- [Netlify Next.js overview](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/)
- [Netlify Next.js configuration values](https://docs.netlify.com/snippets/frameworks/nextjs-config-values/)
- [Environment variables for Netlify Functions](https://docs.netlify.com/build/functions/environment-variables/)
- [Netlify CLI deployment](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/)
