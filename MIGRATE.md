# Migrating a Google AI Studio app to Azure

What was learned moving **Sailability Canterbury** off Firebase and onto Azure
Static Web Apps, carried here because this app is the same shape: a Google AI
Studio React client, an Express server, Firebase behind it, and external users
who reach the app through a link in an email rather than an account.

This is not a procedure. It is the set of things that cost hours there and
would cost them again here. The ordered runbook that came out of it is
[DEPLOY.md](https://github.com/RobSailing/Sailability-Canterbury-Azure/blob/main/DEPLOY.md)
in that repository — worth reading alongside, though its resource names and
domains are that charity's.

Every link below points at
[RobSailing/Sailability-Canterbury-Azure](https://github.com/RobSailing/Sailability-Canterbury-Azure),
which is **private** — they resolve for whoever has access to it, and not for
anyone else.

Ordered by when they bite. Amend it as this migration teaches you more: the
value is in it being a living document rather than a snapshot of what somebody
already knew.

---

## Before anything: the shape of the problem

A Google AI Studio app arrives as a React client, a Firebase backend, and a
JSON export. The client ports almost unchanged. Everything else is a decision.

**The export is not a database.** It is a document dump with no schema, no
foreign keys, and whatever shape the app happened to write. Expect to spend
real time on a migration script that reports rather than assumes — ours prints
every mismatch it finds and refuses to run against non-empty tables. The
mismatches are usually *data*, not errors: 14 apparent organisation conflicts
here turned out to be one deliberate pattern, and "fixing" them would have
merged unrelated families.

**The export contains live secrets.** OAuth client secrets, refresh tokens,
session secrets, access codes, and in this case medical notes. It must never be
pasted into a terminal transcript, a chat, or a ticket. Keep it outside the
repository and add a `.gitignore` net for the day someone copies one in to run
a migration.

**Decide the hosting shape before writing infrastructure.** The choice between
App Service and Static Web Apps is not about price; it is about what the
managed function can and cannot do. See below.

---

## Static Web Apps: what the free plan cannot do

All confirmed against Microsoft's docs, and all discovered after committing to
the platform.

| Constraint | Consequence |
| --- | --- |
| Managed functions have **no managed identity** | You cannot use Entra-only SQL auth via MSI. A service principal with a client secret is the fallback. |
| Managed functions cannot resolve **Key Vault references** | Key Vault becomes the store of record, not a runtime dependency. The deployment reads secrets and writes them into app settings. |
| **45-second cap** on every request, not raisable | Anything slower must be a queued job. Our Gmail import runs in 7–17s, which is fine, and would not be at 40 drafts. |
| **Bring your own functions** requires the Standard plan | The managed function is the only free option. |
| **Custom auth providers** require the Standard plan | Only Entra, GitHub and X are available free, and the free Entra one authorises through `/common` — so only identities Microsoft can find are admitted. Anyone whose address lives outside Entra means upgrading. See below. |
| Any custom registration **disables all preconfigured providers** | Adding Google silently breaks Microsoft sign-in unless you re-declare it too. |

None of this is a reason to avoid the platform. It is a reason to know it
before the SQL server is created as Entra-only.

### The config file has to be inside the build

`staticwebapp.config.json` at the repository root is **ignored**. Static Web
Apps reads it from inside the uploaded app artifact, so with `app_location:
dist` it must be at `dist/staticwebapp.config.json`. In Vite, that means
putting it in `public/`.

The failure this produces names neither the file nor the setting:

```
Cannot deploy to the function app because Function language info isn't provided.
```

`platform.apiRuntime` lives in that file, and with the Oryx build skipped there
is nothing else to detect the language from. A pre-deploy check for the file at
the root passes happily and proves nothing.

### skip_api_build is real but undeclared

`Azure/static-web-apps-deploy@v1` logs `Unexpected input(s) 'skip_api_build'`.
It is passed to the container as `INPUT_SKIP_API_BUILD` and honoured — look for
`Skipping step to build /github/workspace/api with Oryx`. The warning is noise.

---

## The Azure CLI on Windows

**`az` emits CRLF.** `$(az ...)` strips the `\n` and leaves the `\r`. A captured
value then looks correct, has the right length in most tools, and fails in ways
that name something else entirely — a client secret with a trailing carriage
return reaches the app settings and surfaces as a database login failure days
later.

```bash
azv() { az "$@" | tr -d '\r\n'; }
```

Use it for every captured value, and assert on what you captured before using
it: expected length, and no non-printable characters. Do not print secrets to
check them — check them without printing.

This does not reproduce in every shell. It did not reproduce in Git Bash here,
which is why an earlier "fix" tested clean and still failed in the user's
terminal.

### az monitor app-insights query renders nothing in table form

```bash
az monitor app-insights query ... -o table   # empty, whatever the data
az monitor app-insights query ... -o json    # 495 rows
```

The result shape is `{tables: [{columns, rows}]}` and the table/tsv formatters
do not flatten it. An empty output looks exactly like an empty workspace. This
cost an hour of diagnosing a working system as a broken one — including a
confident, wrong report that Application Insights was receiving nothing.

**Always `-o json`, and parse it.**

### Other CLI notes

- `az ad sp create` intermittently throws `JSONDecodeError`. Retry, and treat
  "already in use" as success rather than checking first.
- `az bicep build --file main.bicep` catches template errors in a second.
  A deployment takes two minutes to report the same thing.
- Register `Microsoft.OperationalInsights` **before** the first deployment.
  Application Insights needs a Log Analytics workspace, a subscription that has
  never used one has the provider unregistered, and the deployment fails
  halfway through after creating most of the resources.

---

## Identity and secrets

### The tenant may forbid client secrets

`Credential type not allowed as per assigned policy` means the tenant's default
app management policy has `passwordAddition` enabled. The fix is a **scoped**
`appManagementPolicies` object assigned to that one app registration, not a
change to the tenant default.

### sqlcmd -G does not work off a domain-joined machine

`Failed to resolve the UPN for the current windows account`. Take a token from
the CLI instead and connect with it:

```bash
az account get-access-token --resource https://database.windows.net/
```

Roles inside a database are T-SQL, not ARM, so this is the one deployment step
Bicep cannot do. Until it runs, the application authenticates as nobody and
every query fails while the infrastructure looks perfectly healthy.

### App settings are replaced wholesale

The `Microsoft.Web/staticSites/config@...` `appsettings` resource replaces the
entire collection. A secret added by hand afterwards is deleted by the next
deployment, and a secret left out of the parameters is deleted too — not left
alone. Every deployment must carry every secret.

Guard it: read each from Key Vault, assert non-empty and printable, and refuse
to deploy otherwise. An empty parameter is a deletion, not a no-op.

### The custom domain is a two-pass deployment

The domain cannot validate until DNS points at the site, and the DNS record
cannot be written until the site exists. So deploy with the binding off, take
the generated hostname, add the CNAME, then deploy again with it on.

Make `APP_URL` follow the *binding* rather than the intent, so the first pass
produces working links on the generated hostname instead of links to a name
that does not resolve. Emailed magic links are built from it.

---

## Authentication, which is where the real traps are

### Same header name, different payload

App Service Easy Auth and Static Web Apps both inject
`x-ms-client-principal`. **The payloads are not the same.** Easy Auth sends
`{auth_typ, claims: [{typ, val}]}`; SWA sends
`{identityProvider, userId, userDetails, userRoles}`.

Parse each by its own shape, selected by an explicit `AUTH_MODE`, so naming the
wrong platform fails closed. A parser that accepts either fails *open* on the
platform it was not written for.

### The client is public even when the API is not

Static Web Apps serves the client to anyone unless you add `allowedRoles`
route rules — and you often cannot, because anonymous flows (magic links,
public registration) need to reach `/api/public/*`.

The result: a staff member with no session gets the entire application shell,
populated with nothing, and whatever error the client shows for a failed fetch.
Ours said **"Could not reach the API"**, which is how a working deployment came
to be audited as a broken one, twice.

Handle 401 in the client: redirect to `/.auth/login/aad` and come back to the
page. Guard it — once per tab, re-armed on a successful request — because a
principal that signs in and is then refused by the API will otherwise loop, and
a redirect loop is harder to report than an error message.

### B2B guests arrive under a UPN, not their address

Entra issues an invited guest a principal name inside the tenant:

```
rob_sailabilitycanterbury.org.nz#EXT#@sailabilitycanterbury.onmicrosoft.com
```

That matches no staff domain, so the guest signs in successfully and is then
refused at the allowlist — and every record they touch is attributed to that
string rather than to a person. Translate it back: the `@` became an
underscore, and a domain cannot contain one, so the last underscore is
unambiguously the separator.

**But guests cannot sign in through the preconfigured provider at all.** It
authorises through `/common`:

```
https://login.microsoftonline.com/common/oauth2/v2.0/authorize?…
```

`/common` performs home realm discovery — it asks which tenant owns the address
being typed. A guest object lives in *your* tenant and can only be
authenticated at your tenant's endpoint, so an address on a domain no Entra
tenant claims produces **"We couldn't find an account with that username"**,
and no amount of configuration at the Entra end changes it. Google federation
does not rescue it either: `/common` never gets far enough to hand off.

So B2B guests are *not* the free route to signing in with a Google Workspace
address. They only become usable alongside a custom Entra registration — which
is the Standard plan — because that is what lets you pin `openIdIssuer` to your
own tenant instead of `/common`.

Check which authority a provider uses before designing around it. This was
recommended here as the free option, built, and only then found not to work.

### An allowlist is not authentication

Entra will authenticate a far wider population than your staff. Keep a separate
allowlist, deny when it is empty, and let it hold **several domains** — staff
tend to arrive under more than one. Drop blank entries: a trailing comma leaves
`endsWith('@')`, which is true of every address ever issued.

---

## External users with magic links

The pattern: people who are not staff and have no account reach the app through
a link in an email carrying a code in the URL. It is the right shape for a
charity — no password for a volunteer to forget, nothing to administer — and
almost every rule below exists because the obvious implementation leaks.

Treat the code as what it is: **a bearer token in a URL, sent by email, that
never expires unless you expire it.** Anyone who has the link is the user.

### The rules that keep it safe

**An id in a request is a claim, never a permission.** Every route must
re-resolve the caller from the code and re-check that the row being touched is
theirs. Ours matches a sailor on `supportPersonId` as well as `id`, so another
family's sailor is *not found* rather than *refused* — a URL should not confirm
that a row exists.

This is the one that leaks worst if missed. A single participant's link would
otherwise expose the charity's entire list of families.

**The code never appears anywhere but the emailed link.** Not in an API
response, not in a log line, not in an export, not in a URL the app constructs
for any other purpose. Ours are absent from every export alongside medical
conditions, phone numbers and email addresses.

**Template previews use a fixed fake code**, never a real one:

```ts
export const PREVIEW_ACCESS_CODE = 'preview-only-not-a-real-code';
```

Staff preview emails constantly and screenshot them into chat. A preview that
renders a real recipient's link hands that person's access to whoever sees the
image.

**Rendered email bodies contain live links**, so they cannot be logged, stored
in history, or returned in a send report. The report says who was emailed, not
what they were sent.

**Not everyone gets a code.** Sailors here are registered and booked *by* their
support person and hold none; emergency contacts hold none. Fewer codes in
circulation is strictly better. Decide who genuinely needs one and give it to
nobody else.

**Honour unsubscribe before anything else.** It is set through a public route
that needs no staff involvement, and a bulk send that ignores it mails people
who have explicitly asked not to be mailed. Check it first, and check it in the
same place every send goes through.

**Skip rather than send a broken one.** A template using `{book link}` renders
empty for a recipient with no code — an email whose entire purpose has silently
vanished. Report them as skipped.

### What migration does to codes

**Codes are issued fresh; the old system's are not imported.** They are
credentials from a system you are decommissioning, of unknown age and unknown
exposure.

The consequence has to be stated out loud, in the migration report and to
whoever runs it: **every link already sent stops working.** Ours reissued 138
codes, and 63 people were holding links that silently became dead. Nobody finds
out until they click one.

A migration report claiming "existing links keep working" while the script
reissues every code is worse than no report at all. Ours did, briefly, because
the summary was written from intent rather than from the code.

### What the platform forces

`/api/public/*` must stay reachable anonymously, which means **you cannot put
authentication at the edge**. On App Service, "Require authentication" returns
401 or a redirect for those paths and breaks every emailed link. On Static Web
Apps, `allowedRoles` route rules do the same.

So the client is served to everybody, and the API is the only thing enforcing
anything. See the authentication section above for what that does to staff
sign-in — the two constraints pull in opposite directions and both are real.

Magic links are built from `APP_URL`. Get it wrong and they point at
`localhost:3000`, in an email, to a participant.

### Write the scenarios down

[USE-CASES.md](https://github.com/RobSailing/Sailability-Canterbury-Azure/blob/main/USE-CASES.md) lists what an external user can do, each marked
Built, Partial or Missing. The shape transfers even where the content does not:
*asks for a fresh link*, *unsubscribes*, *cancels a booking*, *invites another
person into their organisation*. Every magic-link system needs those, and
writing them as Missing rather than leaving them absent is what stops a
migration declaring itself finished while a participant has no way to stop the
email.

---

## Make the system able to explain itself

Three of the four production problems in this migration were diagnosed by
inference because nothing recorded what actually happened. All three were
one log line away from being obvious.

**Show the server's own words.** A client helper that read only `body.message`
discarded the wording of 112 error responses that use `{error: '<sentence>'}`.
The Gmail import goes to the trouble of passing on whether Google said
`invalid_client` or `invalid_grant` — the fix differs — and it arrived on
screen as "Could not read the Gmail drafts".

**Log why a request was rejected.** A bare 401 cannot distinguish "never signed
in" from "session dropped" from "signed in with no email claim". Those need
different responses and look identical from outside.

**Log claim types, never claim values.** A type is a schema URI; the value is
the person. Knowing that only `sub` and `roles` arrived is the whole diagnosis,
and none of it needs a name or an address in a log that is retained for thirty
days. Put a test on it.

**Both App Insights settings.** `APPINSIGHTS_INSTRUMENTATIONKEY` *and*
`APPLICATIONINSIGHTS_CONNECTION_STRING`. The instrumentation key is what the
portal's "Enable Application Insights" writes.

---

## Smaller things that still cost time

- **`dotenv` does not override an already-set environment variable.** Useful:
  it means CI and Azure win over a stray `.env`. Also means "edit `.env` to
  point at production, and remember to change it back" is a bad instruction —
  pass the target explicitly instead.
- **The Gmail API has no layouts resource.** Gmail *Layouts* are invisible to
  the API; they have to be saved as drafts first. Drafts are the whole surface.
- **`CONVERT(VARCHAR, HASHBYTES(...), 2)` returns uppercase hex; Node's
  `digest('hex')` returns lowercase.** Comparing them means nothing ever
  matches. Ours would have reported every template with an image as changed,
  forever.
- **Reissuing access codes invalidates every link already sent.** Say so in the
  report. A migration report that claims "existing links keep working" when the
  script drops and reissues every code is worse than no report.
- **Guard the test database hard.** Ours requires the name to contain `test`
  and refuses `*.database.windows.net`. The suite truncates every table.

---

## What to lift from the Sailability repository

| File | Why |
| --- | --- |
| [`bicep/`](https://github.com/RobSailing/Sailability-Canterbury-Azure/tree/main/bicep) | Subscription-scope deployment, two resource groups, conditional custom domain, secrets as `@secure()` parameters. |
| [`scripts/grant-sql-user.ts`](https://github.com/RobSailing/Sailability-Canterbury-Azure/blob/main/scripts/grant-sql-user.ts) | The database-user step Bicep cannot do, without needing a domain-joined machine. |
| [`scripts/kv-sync.ts`](https://github.com/RobSailing/Sailability-Canterbury-Azure/blob/main/scripts/kv-sync.ts) | Moves secrets from `.env` into Key Vault without printing them or putting them in shell history. |
| [`scripts/migrate-backup.ts`](https://github.com/RobSailing/Sailability-Canterbury-Azure/blob/main/scripts/migrate-backup.ts) | Dry-run-first migration that reports mismatches instead of resolving them silently. |
| [`server/auth.ts`](https://github.com/RobSailing/Sailability-Canterbury-Azure/blob/main/server/auth.ts) | Two principal shapes, explicit mode, multi-domain allowlist, guest UPN translation. |
| [`server/routes/public.ts`](https://github.com/RobSailing/Sailability-Canterbury-Azure/blob/main/server/routes/public.ts) | Every magic-link route, each re-resolving the caller from the code and re-checking ownership. |
| [`server/sending.ts`](https://github.com/RobSailing/Sailability-Canterbury-Azure/blob/main/server/sending.ts) | Who is excluded from a send and why — unsubscribe first, then skip anyone the template would render broken for. |
| [`api/src/index.ts`](https://github.com/RobSailing/Sailability-Canterbury-Azure/blob/main/api/src/index.ts) | Express reached over loopback from one Function, rather than rewritten into fifty. |
| [`.github/workflows/ci.yml`](https://github.com/RobSailing/Sailability-Canterbury-Azure/blob/main/.github/workflows/ci.yml) | Deploy gated on tests, then smoke tests that assert the API is **not** open. |

The smoke tests are the part worth copying first. A deploy that returns 200 is
not a deploy that works, and the assertion that earns its place is the one that
fails if participant data is public.

---

# What the MSPC migration added

Written while doing it. Where this contradicts the sections above, it is because
MSPC differs from Sailability in a way that turned out to matter — those places
are called out rather than quietly overwritten.

## Check whether the organisation has a tenant before designing around `/common`

The section above concludes that the free Entra provider is unusable because
`/common` performs home realm discovery. **That conclusion is specific to
Sailability**, whose people hold Google Workspace addresses no Entra tenant
claims.

MSPC staff hold M365 licences on `mspc.org.nz`. Their identities are exactly the
ones `/common` *can* find, so the built-in provider works, and the whole
Standard-plan question disappears.

So the rule is not "the free provider is unusable". It is: **find out whose
identities you are admitting before choosing a plan.** Ask for the sign-in
domain and whether it is an M365 tenant. It is a one-sentence question that
decides a $9/month line item and a day of work.

## Cosmos DB free tier is the document-shaped alternative to the SQL free offer

Sailability went to Azure SQL. For an app whose data came out of Firestore as
schemaless documents, and whose ~90 query sites were all `collection/where/doc`,
Cosmos NoSQL was a much smaller change — containers map to collections and the
documents port unchanged.

Both are free and both are **one per subscription**, so check what is already
taken before designing. `useFreeLimit: null` on an existing SQL database means
the free offer is still available:

```bash
az sql db show ... --query "{free:useFreeLimit, sku:sku.name, pause:autoPauseDelay}"
```

Doing that here also turned up an unrelated fact worth knowing: Sailability's
`sqldb-events` is `GP_S_Gen5` with `autoPauseDelay: -1`, so auto-pause is
**disabled** and a serverless database that was meant to scale to zero bills 24
hours a day.

Three things about the Cosmos free tier that only bite once:

- `enableFreeTier` can be set **only at creation**. An account created without
  it bills from the first read and cannot be converted — it has to be recreated.
- Set `capacity.totalThroughputLimit` to the free grant. Without it, one careless
  container definition starts billing silently.
- Use a **shared-throughput database**. The grant is account-level, so one
  reservation across every container beats a reservation each.

## The client SDK is the migration

The real work was not the database. It was that admins queried Firestore
**directly from the browser**, authorised by security rules — 58 call sites, a
1345-line context file, and a 250-line CSV importer that resolved names to ids
against a full in-memory copy of every person, group and event.

Cosmos has no equivalent of security rules and no client SDK you can safely
expose, so all of it becomes server routes. **Estimate a Firebase migration by
how much of the database access happens in the browser, not by how much data
there is.** The data moved in one script; the browser access took the rest.

Two consequences worth planning for:

- **Do not write a Firestore shim.** A helper that accepts
  `collection(...).where(...)` looks identical at the call site and differs in
  semantics, which is the failure mode that is hardest to find later.
- **Duplicated business rules surface.** The person-classification rules existed
  in four copies here — twice in the browser, twice on the server — and had
  already drifted. Porting is the moment to collapse them into one, because you
  are reading all four anyway.

## Look for whole documents spread into responses

The pattern to grep for is `{ id: d.id, ...d.data() }`.

Two routes here returned every relevant person that way, and a person document
holds `accessCode`. So one leader's magic link returned **the access code of
everyone in their groups**, and a member's returned their linked people's codes.
This is the leak the section above warns about; it was already present.

Route every person through one serialiser, so it cannot come back per-route:

```ts
export function publicPerson(person: Doc): Doc {
    const { accessCode, ...rest } = person;
    return rest;
}
```

Then assert it in the smoke tests: no anonymous response may contain the string
`accessCode`.

Two more places a code leaks that are easy to miss:

- **The query string.** A `?accessCode=` fallback puts credentials into platform
  access logs and Application Insights. Header or body only.
- **A CSV re-import.** This importer minted a fresh code for **every row**,
  including people who already existed — so re-importing the membership list
  silently killed every link already sent. Keep an existing person's code;
  issue one only to someone genuinely new.

## Check where credentials are generated

Access codes here were built **in the browser**:

```ts
const accessCode = uuidv4().replace(/-/g, '') + Math.random().toString(36).substring(2, 8);
```

`Math.random` is not a cryptographic RNG. Generate bearer tokens server-side
with `randomBytes` and nowhere else.

## Static Web Apps Free has five regions, and that can conflict with the data

Central US, East US 2, West US 2, West Europe, East Asia. That is the whole list,
and the managed Function runs in whichever you pick.

For a New Zealand charity the nearest is East Asia — Hong Kong. Cosmos, however,
*is* available in New Zealand North. So there was a real choice, and it was not
a performance question:

- Person records carried a `condition` field holding MS and Parkinson's
  diagnoses. That is health information about identifiable people.
- Onshore Cosmos means every query crosses NZ↔Hong Kong, several times per
  request.
- Co-located Cosmos is fast and puts that health information offshore.

**The way out was to stop storing the thing that created the conflict.** The
classification rules only ever asked *whether* a qualifying condition existed,
never which one, so the database now holds `qualifies: true | false` and the
diagnosis is read at the import boundary and discarded. No health information,
no residency question, and the fast region becomes the obvious default.

That is worth reaching for before accepting a trade-off:

> **Check whether the sensitive field is actually used as sensitive data.** A
> field can look like it forces an architecture decision and turn out to be a
> boolean wearing a diagnosis as a costume.

Two places it would otherwise leak back in:

- **The downloadable CSV template.** Ours offered a `condition` column, which
  invites staff to type diagnoses into a spreadsheet and email it around. The
  template says `qualifies` now; the importer still accepts a legacy
  `condition` column and still throws the wording away.
- **The audit log.** The importer wrote `JSON.stringify(row)` of each imported
  row. That puts the raw CSV — diagnosis included — into a retained log, through
  the back door, after all the care taken elsewhere. Redact at the point of
  writing the log, not at the point of reading it.

Where a field genuinely is sensitive, make the region a deployment parameter
with the trade-off written next to it, because Cosmos cannot change region
without recreating the account.

## Smaller things, again

- **`ARRAY_CONTAINS` removes the chunking.** Firestore's `where(field, "in", …)`
  caps at 30 values, so ported code is full of `for (let i = 0; i < ids.length;
  i += 30)`. Cosmos takes the whole array as one parameter. Delete the loops
  rather than widening them.
- **Cosmos `patch` 404s on a missing item.** Firestore's `set(…, {merge: true})`
  creates. They are not the same operation and swapping them loses writes.
- **Cosmos has no server timestamp.** `serverTimestamp()` has no equivalent;
  write ISO 8601 strings. They survive a JSON round-trip, which a Firestore
  Timestamp does not — a migration must convert `{_seconds, _nanoseconds}` too.
- **Re-key admins from auth uid to email.** Firestore keyed `admins/{uid}`; an
  Entra principal carries an address, not that uid. Any admin document without
  an `email` field cannot be translated — report each one loudly, because the
  failure mode is a person quietly no longer being an admin.
- **Node's test runner does not discover `.ts` files from a directory**, and a
  glob in an npm script is expanded by bash and left alone by cmd.exe. Build the
  file list in a small runner script instead of fighting either shell.
- **Collapse internal whitespace when matching names.** `"Dan" + " Ray "`
  trims to `"Dan  Ray"`, with two spaces, and never matches `"Dan Ray"`. CSV
  fields are padded constantly. A test caught this; trimming alone does not.
- **A `/me` route beats a bare 401.** "Not signed in", "signed in with no email
  claim", "wrong domain" and "no admin record" are four different problems that
  need four different responses and look identical from outside.
