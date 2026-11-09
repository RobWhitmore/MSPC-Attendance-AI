# MSPC Attendance

Internal application to streamline attendance tracking for meetings and events.
Staff sign in with their MSPC Microsoft account; members and leaders reach their
tightly-scoped views through per-person magic links and never sign in at all.

Runs entirely on free Azure services.

## Stack

- **Frontend:** React 19 + Vite + Tailwind CSS v4
- **Backend:** Express (TypeScript), inside a single Azure Function
- **Data:** Azure Cosmos DB (NoSQL, free tier) — reached only by the server
- **Hosting:** Azure Static Web Apps (Free plan), with Entra sign-in for staff

The browser never talks to the database. Every read and write goes through the
API, which is the only thing enforcing authorisation.

## Run locally

**Prerequisites:** Node.js 22.3+ (`engines` enforces it; the route tests need
`mock.module`), and a database — no Azure subscription required.

### With the Cosmos DB emulator (recommended)

Gives you the real thing: the SQL in `repo.ts` actually executes, which is not
true of the in-memory substitute the tests use.

1. `winget install Microsoft.Azure.CosmosEmulator`
2. Start it, and wait for it to listen on 8081 — first launch takes a few
   minutes:
   ```
   & "C:\Program Files\Azure Cosmos DB Emulator\Microsoft.Azure.Cosmos.Emulator.exe"
   ```
3. `npm install`
4. Copy `.env.example` to `.env`, then point it at the emulator:
   ```
   COSMOS_ENDPOINT="https://localhost:8081/"
   COSMOS_KEY="C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw=="
   COSMOS_DATABASE="mspc"
   NODE_TLS_REJECT_UNAUTHORIZED="0"
   DEV_ADMIN_EMAIL="dev@mspc.org.nz"
   ```
   That key is a well-known constant published by Microsoft, identical on every
   machine — not a secret. `NODE_TLS_REJECT_UNAUTHORIZED` is needed because the
   emulator serves a self-signed certificate; never set it anywhere else.
5. `npm run dev:db` — creates the containers and seeds enough data for every tab
   to render. Add `-- --reset` to start clean. It refuses to run against
   anything but localhost.
6. `npm run dev` — API and Vite app on http://localhost:3000

`DEV_ADMIN_EMAIL` stands in for the principal Static Web Apps injects, and the
seed data includes a matching `admins` record. The server refuses to start if it
is set with `NODE_ENV=production`.

### Against real Cosmos

Set `COSMOS_ENDPOINT`, `COSMOS_KEY` and `COSMOS_DATABASE` to the deployed
account and skip steps 1, 2 and 5. `npm run dev:db` will refuse to run.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Express with Vite middleware |
| `npm run dev:db` | Create and seed the local emulator database (`-- --reset` to drop first) |
| `npm run build` | Build the client and bundle the Function |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests for auth and classification |
| `npm run smoke -- <url>` | Post-deploy checks that the API refuses anonymous callers |
| `npm run kv-sync -- <push\|check> <vault>` | Move secrets to Key Vault, or verify them |
| `npm run clean` | Remove build output |

## Documentation

| Document | What it covers |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | The target design and the reason for each decision |
| [DEPLOY.md](DEPLOY.md) | Ordered deployment runbook, including the two-pass custom domain |
| [PROVISION.md](PROVISION.md) | What MSPC's IT provider must set up first — subscription, Entra, DNS |
| [INFOODLE-CSV.md](INFOODLE-CSV.md) | Loading from Infoodle by CSV export, before API access exists |
| [INFOODLE-API.md](INFOODLE-API.md) | The Infoodle calls the load depends on, field by field |
| [HANDOVER.md](HANDOVER.md) | What a maintainer needs that the code does not say |
| [MIGRATE.md](MIGRATE.md) | The traps that shaped all of the above |
| [requirements.md](requirements.md) | Product requirements and behaviour |
