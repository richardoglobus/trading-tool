# Tickwise project handoff

This bundle is a source snapshot for a **new, separate Manus account/project**. It includes the website source, dependency lockfile, production Dockerfile, database schema/migration, route manifest, Deriv source notes, and this handoff documentation. It intentionally excludes `.git` history, `node_modules`, build output, `.env` files, credentials, the original account’s admin email, and all managed database contents.

## Current state at handoff

The project contains the Deriv public tick analyzer, 5/20 SMA indicator, paper-only simulator, client-side USD balance sizing, Manus OAuth integration, a server-side private-page gate, and the single-admin email allowlist. In the original Manus project, Server and Database were enabled, the initial users-table migration was applied, and the protected `TICKWISE_ADMIN_EMAIL` setting was configured. None of those account-specific settings or the original database are copied here.

`pnpm check` and `pnpm build` passed in the source project. Local HTTP checks showed `/` redirects to `/login`, `/login` and `/api/health` respond, and the route manifest is valid JSON. However, the Preview screenshot tool returned a blank white image for the login page, and a real Manus OAuth sign-in was not completed. **Treat the login UI as not yet visually verified; diagnose it and verify the approved account can sign in before publishing.** The project was not published; this bundle has no public website URL.

## Import into another Manus account

1. Download this ZIP, then sign in to the destination Manus account and start a new website/WebDev task.
2. Upload the ZIP to that task and also provide `CONTINUATION_PROMPT.md`. Ask Manus to create a **new** managed WebDev website and restore the files into it. Do not attach or reuse the original account’s database or credentials.
3. Enable the new project’s managed **Server** and **Database** capabilities when asked. These are required for Manus OAuth and the user table.
4. In the destination project’s protected secret settings, set `TICKWISE_ADMIN_EMAIL` to the destination admin’s Manus account email, with both development/Preview and production scope. Do not copy the original account’s email or any other account’s secrets.
5. In the new project directory, install from the lockfile and apply the included migration: `pnpm install --frozen-lockfile`, then `pnpm db:migrate`. Run `pnpm check` and `pnpm build`. Start Preview with the project’s server command (`pnpm dev` in this template).
6. Verify unauthenticated `/` redirects to `/login`, only the allowlisted Manus account can reach the dashboard, `/api/health` remains available to the hosting health check, and the balance input is not transmitted or persisted. Diagnose the blank Preview before treating login as complete. Keep the site unpublished until the destination account explicitly approves publication.

The app needs Manus-managed runtime values such as its own project ID, OAuth/session signing secret, and database URL. The new WebDev project should provision these; do not copy values from another account or place them in frontend code. The Deriv quote feed is public and requires no Deriv API token. Tickwise does not place orders or predict the next tick.

## GitHub and project access

This ZIP does **not** grant access to the original Manus project, its canonical repository, or its database. The original project’s configured Git provider is Manus—not GitHub—and `.git` history is deliberately excluded. The destination account therefore needs its own WebDev project and its own source-control connection.

If the destination owner wants a private GitHub repository, create an empty repository under an account they control, restore the files into a local checkout, then—if that directory has no `.git` directory—run:

```bash
git init -b main
git add .
git commit -m "Import Tickwise handoff"
git remote add origin https://github.com/OWNER/REPOSITORY.git
git push -u origin main
```

Replace `OWNER/REPOSITORY` with the destination repository. Alternatively, connect the new WebDev project to that private repository through the destination account’s GitHub integration and follow Manus’s checkpoint flow. The original Manus repository will remain inaccessible unless its owner separately configures a supported sharing/transfer path.

## Running outside Manus

The project uses Node.js 22 and pnpm 10.18.0. A local frontend/server process can be started with `pnpm dev`, but Manus OAuth and database-backed sessions require valid Manus-managed runtime configuration and a migrated database. A plain local checkout without those values will not provide a working private sign-in. Never put the admin email allowlist, session secret, database URL, or OAuth secrets in client-side files.
