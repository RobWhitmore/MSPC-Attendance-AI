# Handover: MSPC Attendance (Azure)

Everything a new maintainer needs that is **not** discoverable from the code.
Read this before changing anything.

See also: [ARCHITECTURE.md](ARCHITECTURE.md) for why the system is shaped the
way it is, [DEPLOY.md](DEPLOY.md) for the deployment runbook, and
[MIGRATE.md](MIGRATE.md) for the traps that shaped both.

## What this app is

Attendance / rostering app: people, groups, events, rosters, audit logs.

Three kinds of user, and this shapes the whole security model:

- **Admins / staff** sign in with their **`@mspc.org.nz` Microsoft account** and
  talk only to `/api/admin/*`. Authorisation is two independent checks: the
  email's domain must be in `ADMIN_EMAIL_DOMAINS`, **and** a record must exist in
  the `admins` container keyed by that lowercased email.
- **Members and leaders** never sign in. They use emailed magic links (access
  codes) and everything goes through `/api/portal` and `/api/leader`.

Stack: React + Vite (client), Express inside a single Azure Function, Cosmos DB
for data, Azure Static Web Apps for hosting. All on free plans.

**The browser never touches the database.** There is no client-side database
SDK. This is the single biggest difference from the Firebase version, where
admins queried Firestore directly and security rules did the authorising.

## Deployment: how code reaches production

```
GitHub repo  ->  push to main  ->  CI: typecheck, test, build
                                    ->  deploy to Static Web Apps
                                    ->  smoke tests
```

Deployment is automatic on push to `main`, and **gated on the tests passing**.

- **Live URL:** https://app.mspc.org.nz
- **Health check:** `<url>/api/health` returns
  `{"status":"ok","message":"Cosmos DB connected"}` — this proves the app is
  serving *and* reaching the database in one request. Use it after every deploy.

### When a deploy doesn't appear

GitHub → Actions. A failed build leaves the previous version serving, so the app
keeps working and you get no warning.

## ⚠️ Things that will break production if lost or changed

| File / setting | Rule | What happens if broken |
| --- | --- | --- |
| `public/staticwebapp.config.json` | Must stay in `public/`, so Vite copies it to `dist/` | Static Web Apps reads it from **inside the artifact**. At the repo root it is ignored and the deploy fails with `Function language info isn't provided` — which names neither the file nor `platform.apiRuntime`. CI checks for this. |
| `package-lock.json` | Must exist and be committed | CI runs `npm ci`, which fails without it |
| `package.json` → `optionalDependencies` | Keep the 4 Linux native binaries | CI builds on Linux; npm/cli#4828 omits them from a lockfile generated on Windows. Bump these pins whenever you upgrade vite, rollup, esbuild or tailwind. |
| Cosmos `enableFreeTier` | Never recreate the account without it | Set only at creation. An account made without it **bills from the first read** and cannot be converted. |
| Cosmos partition keys | Cannot be changed | Changing one means a new container and a data copy |
| `AUTH_MODE=swa` | Must be present | Unset or wrong, `getPrincipal` returns null and **every admin is locked out**. This is deliberate: it fails closed. |
| `ADMIN_EMAIL_DOMAINS` | Must be non-empty | Empty denies all admin access, by design |
| Bicep `appsettings` | Every deployment must carry **every** setting | The resource replaces the whole collection. A setting added by hand is deleted by the next deploy; a parameter left empty is a **deletion**, not a no-op. |

### The one that catches people

**App settings are replaced wholesale.** If you add a setting in the portal to
fix something quickly, the next `main` push silently removes it. Add it to
`bicep/app.bicep` instead.

## Admin access is keyed by email address

An admin is anyone with a document at `admins/{their-lowercased-email}`, on an
allowlisted domain. To add an admin, create that document (Cosmos Data Explorer
is fine). They do not need to sign in first — unlike the Firebase version, where
you had to wait for an Auth UID to exist.

Both checks must pass. Being in the tenant is not enough; having a record on a
non-allowlisted domain is not enough either.

**Authentication is not authorisation.** The built-in Entra provider authorises
through `/common`, which will happily authenticate a personal Microsoft account
from anywhere in the world. The allowlist is the only thing standing between
that and the data.

## Access codes are credentials

Treat a code as what it is: **a bearer token in a URL that never expires unless
you expire it.** Anyone who has the link is that user.

Rules the code enforces, which you should not relax:

- A code **never appears in an API response**. Every person object goes through
  `publicPerson()` in [src/server/auth.ts](src/server/auth.ts), which strips it.
  The Firebase version did not do this, and one leader's link returned the
  access code of everyone in their groups.
- A code is **never read from the query string**, only from the `x-access-code`
  header or a JSON body. Query strings reach platform access logs.
- Codes are **generated server-side** with `randomBytes`. The Firebase version
  built them in the browser from `uuidv4() + Math.random()`; `Math.random` is not
  a cryptographic RNG.
- **An id in a request is a claim, never a permission.** Every portal and leader
  route re-resolves the caller from their code and re-checks ownership.

### Re-importing people no longer rotates codes

A CSV import of `people` in the Firebase version minted a **new access code for
every row**, including existing people — silently killing every link already
sent. The importer now keeps an existing person's code and only issues one to a
genuinely new person.

## The diagnosis is not stored, deliberately

Firestore held `condition: "MS"` or `"PD"` against a named person. Cosmos holds
`qualifies: true | false`, because that is all the classification rules ever
asked. A `condition` column on an import is now **refused with a warning**, and
nothing in the codebase interprets diagnosis wording — `classify.test.ts`
asserts both, so reinstating it means arguing with a test.

Keep it that way. If MSPC needs the diagnoses for anything, they belong
somewhere built to hold them, not in this app.

**MS and PD are still distinguished, by group.** `groupTypes.shortValue` is `MS`
or `PD`, so allocating someone to a condition-specific group records which
condition they are served for. That was always the real carrier; the person-level
field was a second copy that nothing read. Allocation happens in Infoodle and
arrives here as group membership — see [INFOODLE-CSV.md](INFOODLE-CSV.md).

**Do not read "no diagnosis" as "nothing sensitive".** Group membership under an
`MS` or `PD` group type implies the condition, so the database holds
health-inferable data about identifiable people regardless. That is unavoidable
in a system built for condition-specific groups, but it means the backup, the
audit log and the choice of region all deserve to be treated accordingly.

That is why **Cosmos is in New Zealand North while the app is in East Asia**.
The Static Web Apps Free plan does not exist in any region near New Zealand, so
the two are deliberately split rather than co-located, and every query pays a
~140 ms round trip for it. If you are tempted to move the database next to the
app to make things faster, that is the trade you would be reversing — and the
region cannot be changed without recreating the account. See
[DEPLOY.md §2](DEPLOY.md).

## The system backup contains access codes

`/api/admin/backup` is the one response that includes them, because a restore
that dropped them would invalidate every link in circulation. That download is
therefore **a credential store**: it also carries email addresses, phone numbers
and medical conditions. Do not put one in chat, a ticket, or a shared drive.
`.gitignore` has a net for `*backup*.json` for the day somebody copies one in.

## Configuration that lives outside the repo

Set as Static Web Apps app settings by the Bicep deployment, read from Key Vault:

| Setting | Notes |
| --- | --- |
| `COSMOS_ENDPOINT` | Account URI |
| `COSMOS_KEY` | Read-write key; the only real secret |
| `COSMOS_DATABASE` | `mspc` |
| `AUTH_MODE` | `swa` |
| `ADMIN_EMAIL_DOMAINS` | `mspc.org.nz` |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Telemetry |
| `APPINSIGHTS_INSTRUMENTATIONKEY` | Also required — what the portal's "Enable Application Insights" writes |

There is no `APP_URL`. Magic links are client-side routes and the app sends no
email, so nothing server-side builds an absolute URL.

## Running costs (~$0)

See the table at the end of [DEPLOY.md](DEPLOY.md). The Cosmos account is capped
at `totalThroughputLimit: 1000`, the free grant, so a bad container definition
cannot quietly start billing.

## Local development

**Node 22.3 or newer is required to run the tests** (the route tests substitute
the data layer using `node:test`'s `mock.module`). The deployed Function still
runs `node:20` — that is the runtime, set by `platform.apiRuntime`; this is only
the build and test toolchain.

```sh
npm install
npm run dev          # Express + Vite on http://localhost:3000
npm run typecheck
npm test
npm run build        # client + API bundle - run before pushing
npm run smoke -- https://app.mspc.org.nz
```

If `npm test` reports an old Node while `node --version` shows a new one,
something is shadowing it. A `node` package installed into a `node_modules`
directory does exactly that, and npm prefers it over your PATH:

```sh
node --version                # your shell
npm exec -- node --version    # what npm scripts actually get
```

## How the tests reach the routes without a database

There is no Cosmos emulator involved. `test/fake-repo.ts` is an in-memory
implementation of `src/server/repo.ts`, substituted with `mock.module`. Because
every read and write in the app goes through that one module, the Express app,
the routers, the auth gate, the classification rules and `publicPerson` all run
as shipped — only storage is fake.

`test/routes.test.ts` is where the security assertions live: that the API
refuses anonymous callers, that an access code does not open the admin API, that
an id in a request body is not a permission, and that no response carries an
`accessCode`. Reintroducing the old leak in `publicPerson` fails three of them.
Keep it that way.

Local development needs a real Cosmos endpoint and key in `.env` (see
`.env.example`). To work on admin routes locally, set `DEV_ADMIN_EMAIL` — it
forges the header Static Web Apps would inject. The server **refuses to start**
if that variable is set with `NODE_ENV=production`.

## Diagnosing problems

Three of the four production problems in the previous migration were diagnosed
by inference because nothing recorded what happened. The code now logs why a
request was rejected — "no principal", "no email claim", "domain not
allowlisted", "no admins record" are four different problems that all look like
a bare 401 from outside.

**Log claim types, never claim values.** A type is a schema URI; the value is the
person. There is a test on this.

When querying Application Insights from the CLI, **always use `-o json`**:

```bash
az monitor app-insights query ... -o table   # empty, whatever the data
az monitor app-insights query ... -o json    # the actual rows
```

The result shape is `{tables: [{columns, rows}]}` and the table formatter does
not flatten it. An empty output looks exactly like an empty workspace, and that
has cost an hour of diagnosing a working system as a broken one.

## What is still missing

- **Nothing has ever run against real Azure.** Cosmos, the Function proxy and
  Entra sign-in are written to documented contracts and remain unproven. The
  local emulator exercises `repo.ts` for real, which is the largest part of the
  risk, but not the platform around it.
- **The subscription is reported to be *renewed*, not newly created**, and
  believed unused. That is unverified, and three things depend on it: the Cosmos
  free-tier grant is one per subscription and cannot be added later; our Key
  Vault and Cosmos names are generated by `uniqueString(resourceGroup().id)`, so
  a previous deployment in the same subscription would produce identical names,
  and a soft-deleted vault holds its name for 90 days against purge protection;
  and New Zealand North availability was confirmed against a *different*
  subscription. [DEPLOY.md §0.5](DEPLOY.md) is the check — run it first.
- **Reports** and **Settings** tabs are placeholders, as they were before.
- **No email.** Access codes are distributed by hand. If that becomes painful,
  adding a sender means also adding unsubscribe handling, a fixed fake code for
  template previews, and a send report that says *who* was mailed rather than
  *what* they were sent — see MIGRATE.md.
- **`auditLogs` is written but never read.** There is no UI for it.

## Sanity checklist before you push

1. `npm run typecheck`, `npm test` and `npm run build` all pass.
2. `git diff` shows nothing removed from the table above.
3. After CI finishes, hit `/api/health` and confirm `{"status":"ok"}`.
4. Confirm the smoke job passed — it is what proves the API is not open.
