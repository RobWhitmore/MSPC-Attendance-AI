# MSPC Attendance on Azure — target architecture

The decisions behind the port, and why each one was made. Read
[MIGRATE.md](MIGRATE.md) first for the traps this design is written to avoid;
read [DEPLOY.md](DEPLOY.md) for the ordered runbook.

## The shape

```
                    app.mspc.org.nz
                          |
              Azure Static Web Apps (Free)
              |                          |
        /  -> dist/                /api/* -> managed Function
        (React client)                    (one Function, Express inside)
              |                                     |
     /.auth/login/aad                        Cosmos DB NoSQL
     Entra /common                           (free tier: 1000 RU/s, 25 GB)
     staff sign-in
```

Everything in that diagram is on a free plan. Nothing in it is Google.

## What changed from the Firebase version, and why

| Was | Now | Why |
| --- | --- | --- |
| Firestore | Cosmos DB NoSQL, free tier | Document-shaped, so `people`/`groups`/`events`/`rosters`/`groupMembers` port as containers rather than being remodelled into tables. 25 GB and 1000 RU/s free forever, one per subscription. |
| Admin browser talks to Firestore **directly** | Admin browser talks to `/api/admin/*` only | There is no Cosmos equivalent of Firestore security rules, and no client SDK that is safe to expose. Every one of the ~58 direct call sites becomes a server route. This is the largest single piece of the port. |
| Firebase Auth, Google sign-in, `admins/{uid}` | SWA built-in Entra (`/common`) + `@mspc.org.nz` allowlist + `admins` container keyed by email | MSPC staff hold M365 licences on `mspc.org.nz`, so Entra can find them and `/common` home-realm discovery resolves. This is the case MIGRATE.md's `/common` warning does **not** cover. Keeps us off the SWA Standard plan. |
| Firebase ID token in `Authorization: Bearer` | `x-ms-client-principal` injected by SWA | Free, and the platform verifies the token before our code runs. Parsed strictly as the **SWA** payload shape under an explicit `AUTH_MODE`, never as the Easy Auth shape. |
| Express listening on `PORT` under App Hosting | Express reached over loopback from one managed Function | MIGRATE.md: one Function, not fifty rewritten handlers. |
| Access codes generated client-side | Access codes generated server-side with `randomBytes` | The old generator was `uuidv4() + Math.random()`. `Math.random` is not a CSPRNG, and these are bearer tokens in URLs. |
| Firestore `serverTimestamp()` | ISO 8601 strings written server-side | Cosmos has no server-side timestamp sentinel. ISO strings survive JSON round-trips, which Firestore Timestamps do not. |

## Identity: three populations, three mechanisms

This is unchanged in intent and entirely changed in implementation.

**Staff / admins** sign in at `/.auth/login/aad`. SWA validates with Entra and
injects `x-ms-client-principal`. The API then applies *two* independent checks:

1. The email's domain is in `ADMIN_EMAIL_DOMAINS` (`mspc.org.nz`). Blank
   entries are dropped — a trailing comma otherwise leaves `endsWith('@')`,
   which is true of every address ever issued.
2. A document exists in the `admins` container keyed by the lowercased email.

Authentication is not authorisation. `/common` will happily authenticate a
personal Microsoft account from anywhere in the world; the allowlist is what
stops it, and it denies when empty rather than allowing.

**Members and leaders** never sign in. They arrive on `/portal/:accessCode` or
`/leader/:accessCode` and the code goes in the `x-access-code` header. Every
route re-resolves the caller from the code and re-checks that the row being
touched is theirs. An id in a request body is a claim, never a permission.

**Nobody else.** `/api/public/*` does not exist in this app — there is no
self-registration and no unsubscribe, because the app sends no email.

### Why authentication cannot go at the edge

`allowedRoles` route rules in `staticwebapp.config.json` would return 401 for
`/api/portal/*` and break every magic link. So the client is served to
everybody and the API is the only thing enforcing anything. The client handles
its own 401 by redirecting to `/.auth/login/aad`, guarded once per tab and
re-armed on success, so a principal who signs in and is then refused by the
allowlist gets an error rather than a redirect loop.

## Cosmos DB layout

One database, `mspc`, with **shared throughput** — the free tier's 1000 RU/s is
an account-level grant, and sharing it across containers means no container
needs its own reservation.

| Container | Partition key | Why that key |
| --- | --- | --- |
| `people` | `/id` | Looked up by id, by `accessCode`, by name pair, by `supportPersonId`. No natural grouping; the container is small enough that cross-partition scans are cheap. |
| `groups` | `/id` | Small, read whole. |
| `groupTypes` | `/id` | Tiny. |
| `events` | `/groupId` | Almost every read is "events for these groups". |
| `rosters` | `/eventId` | Almost every read is "the roster for this event". |
| `groupMembers` | `/groupId` | Almost every read is "who is in this group". |
| `admins` | `/id` | `id` is the lowercased email address. |

Firestore auto-ids are valid Cosmos ids, so they carry over unchanged.

### Field-level rules

`accessCode` is a credential. It is **stripped from every API response** except
the caller's own record. The Firebase version did not do this: `/api/leader/data`
and `/api/portal/data` returned whole person documents, so a single leader's
link exposed the access code of everyone in their groups. Serialisation goes
through one `publicPerson()` function so this cannot regress per-route.

Leaders get less again. Most are volunteers rather than staff, so
`/api/leader/data` sends people through `leaderViewOfPerson()`, an allowlist of
what the roster screen draws: name, type, carer link. Email, phone, `qualifies`
and the Infoodle ids never go to a leader. A member's `/api/portal/data`
carries only their own and their linked people's roster rows — the whole
roster would give every member everyone's notes.

### Attendance is recorded for the group only

"The group" is its members plus the carer on the other end of each member's
support-person link (`groupReach()` in [portal.ts](src/server/routes/portal.ts)).
Carers are part of the group and may attend without their member; they are
rarely members in their own right, so the leader's data lists them as `support`
entries derived from the link, never written back. That one definition decides
both what a leader sees and whom they may mark, so the two cannot drift apart.

Leaders do not create people. The Firebase version let a leader add a walk-in
as a person record, with phone, email and a "medical info" note, from their
own phone; that was never carried over. Anyone else who came goes in a
free-text **extras note** sent with Submit
Roster, stored as `events.extrasNote` (capped at 2000 characters) for staff to
follow up in Infoodle. It is stripped from every member response, because it
can name people outside the member's group.

### No diagnosis is stored

Firestore held a `condition` field containing `"MS"` or `"PD"` against a named
person — health information about an identifiable individual, which would have
forced a data-residency decision (see below) and raised the stakes on every
export, backup and audit log.

The classification rules only ever asked **whether** a qualifying condition
existed, never which one. So Cosmos stores `qualifies: true | false` and nothing
else.

Briefly there was a middle position — a `condition` column accepted on import,
reduced to the boolean by `qualifiesFromText()` and discarded. That is gone too.
Nothing was stored either way, but a supported column is an invitation to export
one, and the exposure is the CSV sitting in a downloads folder, not what the
importer subsequently does with it. A `condition` column is now **refused with a
warning** rather than ignored, because silently ignoring it would mark every row
as not qualifying and reclassify the whole file as `external`.

Nothing in the codebase interprets diagnosis wording any more, and
[classify.test.ts](test/classify.test.ts) asserts it, so a helpful
reinstatement has to argue with a test. The downloadable CSV template says
`qualifies`. Audit-log rows are redacted the same way — writing the raw import
row, or quoting the rejected value back in the warning, would put the diagnosis
in the database through the back door.

### MS and PD are still distinguished — by group

Removing the field did not remove the distinction. `groupTypes.shortValue` is
`MS` or `PD`, groups belong to a group type, and `groupMembers` links a person
to a group. Allocating someone to the Rangiora Parkinson's group *is* the record
of which condition they are served for. The person-level `condition` field was a
second copy of that fact, and the copy nothing read.

The allocation therefore happens in Infoodle, where the diagnosis lives, and
arrives here as group membership. See [INFOODLE-CSV.md](INFOODLE-CSV.md).

### Region — the app and the data are in different countries

| | Region | Fixed by |
| --- | --- | --- |
| Static Web App + Function | `eastasia` (Hong Kong) | The Free plan exists in five regions; East Asia is the only Asia-Pacific one |
| Cosmos DB | `newzealandnorth` (Auckland) | A choice — the data stays onshore |

An earlier draft co-located them in East Asia on the grounds that no health
information is stored. That was **too strong a claim**. No diagnosis is stored,
but group membership under an `MS` or `PD` group type implies one, and that
inference is unavoidable in a system built to run attendance for
condition-specific groups. Calling it group membership does not change what it
discloses, so the data is treated as health information and kept in New Zealand.

**The cost is a ~140 ms round trip on every Cosmos query**, since the Function
is in Hong Kong. This is the single biggest performance constraint in the
design, and it changes what good code looks like here: the win is in making
*fewer* queries, not faster ones. `byIds` and `byFieldIn` in
[repo.ts](src/server/repo.ts) exist for that — each replaces a loop of round
trips with one. A new route that queries inside a loop will be slow in a way
that no amount of local testing against the emulator will reveal.

Cosmos cannot change region without recreating the account, so this is settled
rather than tunable. [DEPLOY.md §2](DEPLOY.md) has the arithmetic and the
fallback if the free tier turns out not to be grantable in Auckland.

## Secrets and how they reach the app

Managed Functions have **no managed identity** and **cannot resolve Key Vault
references** (MIGRATE.md). So Key Vault is the store of record and the
deployment reads from it and writes app settings:

```
Key Vault  --(deploy reads)-->  SWA app settings  --(runtime)-->  Function
```

The `appsettings` resource **replaces the whole collection**, so every
deployment must carry every setting. An omitted parameter is a deletion, not a
no-op. The deploy asserts each value is non-empty and printable before writing.

| Setting | Purpose |
| --- | --- |
| `COSMOS_ENDPOINT` | Account URI. Not secret, but must be present. |
| `COSMOS_KEY` | Read-write key. From Key Vault. |
| `COSMOS_DATABASE` | `mspc` |
| `AUTH_MODE` | `swa`. Selects the principal parser explicitly so naming the wrong platform fails closed. |
| `ADMIN_EMAIL_DOMAINS` | `mspc.org.nz` |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Telemetry. |
| `APPINSIGHTS_INSTRUMENTATIONKEY` | Also required — this is what the portal's "Enable Application Insights" writes. |

`APP_URL` is deliberately absent. Magic links in this app are client-side
routes; nothing server-side constructs an absolute URL, and nothing emails one.

## Build layout

`staticwebapp.config.json` lives in `public/`, so Vite copies it to
`dist/staticwebapp.config.json`. At the repository root it is **ignored**, and
the failure names neither the file nor the setting — it says
`Function language info isn't provided`, because `platform.apiRuntime` lives
inside it.

```
public/staticwebapp.config.json  ->  dist/staticwebapp.config.json
src/                             ->  dist/            (client, Vite)
api/                             ->  the managed Function
src/server/                      ->  bundled into api/ by esbuild
```

## Custom domain is a two-pass deployment

`app.mspc.org.nz` cannot validate until DNS points at the site, and the CNAME
cannot be written until the site exists. Deploy with the binding off, take the
generated hostname, add the CNAME, deploy again with it on. See DEPLOY.md.

## What is deliberately not here

- **No email.** The app has never sent any. Access codes are distributed by
  staff out of band. This removes unsubscribe handling, template previews and
  send reports from the threat model entirely — and it is why reissuing codes
  is a manual redistribution job.
- **No Key Vault reference syntax** in app settings — managed Functions cannot
  resolve it.
- **No `/api/public/*`** — nothing in this app is reachable without either a
  principal or an access code.
