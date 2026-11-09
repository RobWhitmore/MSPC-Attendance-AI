# Deploying MSPC Attendance to Azure

The ordered runbook. Read [MIGRATE.md](MIGRATE.md) for *why* several of these
steps look the way they do, and [ARCHITECTURE.md](ARCHITECTURE.md) for what is
being built.

Everything here is on a free plan.

---

## 0. Before you start

You need:

- **A dedicated Azure subscription.** The Sailability subscription already
  exists in this tenant; this app is going in its own. Cosmos DB's free tier is
  **one per subscription**, so a fresh subscription means a fresh grant.

  ⚠️ **The subscription MSPC has is reportedly *renewed*, not newly created.**
  It is believed never to have been used, but that has to be verified rather
  than assumed — two decisions in this runbook depend on the subscription being
  effectively empty. Run §0.5 first.
- **An Entra tenant that owns `mspc.org.nz`.** Staff sign in with their M365
  accounts. This is what makes the free plan viable: Static Web Apps' built-in
  Entra provider authorises through `/common`, which performs home realm
  discovery, so only identities Microsoft can find can sign in. MSPC addresses
  are Microsoft-findable. Google Workspace addresses would not be, and would
  force the Standard plan.
- **Owner or Contributor** on that subscription, plus permission to create an
  app registration if you later move off the built-in provider.
- `az` CLI, Node 20, and `gh` if you want to set repository secrets from the
  command line.

```bash
az login
az account set --subscription "<the subscription id>"
az account show --query "{sub:name, tenant:tenantDefaultDomain}" -o json
```

### A helper you will want on Windows

Define this now — everything below uses it.

`az` emits CRLF. `$(az ...)` strips the `\n` and leaves the `\r`. A captured
value then looks correct, has the right length in most tools, and fails later as
something that names nothing to do with a stray carriage return — a Cosmos key
with one on the end surfaces as an authentication failure days afterwards.

```bash
azv() { az "$@" | tr -d '\r\n'; }
```

Use it for **every** captured value. Assert on what you captured before using
it — expected length, no non-printable characters — and do not print secrets to
check them. `npm run kv-sync -- check <vault>` does exactly this.

---

## 0.5 Check what is already in the subscription

**Do this before anything else.** MSPC's subscription was renewed rather than
created, so "it was never used" is a claim to test, not a starting assumption.
None of these commands change anything.

```bash
SUB=$(azv account show --query id -o tsv)
echo "checking subscription $SUB"
```

### Is the Cosmos free-tier grant still available?

The single most important check. `enableFreeTier` can only be set when an
account is created, and the grant is **one account per subscription**.

```bash
az cosmosdb list --query "[].{name:name, rg:resourceGroup, free:enableFreeTier, location:location}" -o table
```

- **No output** — the grant is available. Proceed.
- **An account with `free: True`** — the grant is **taken**. Ours will fail at
  creation. Either delete that account (if it is genuinely unused), or deploy
  without free tier and accept the cost. That is MSPC's decision, not ours.
- **An account with `free: False`** — the grant is still available, but ask why
  the account exists before adding another.

### Are the names we generate already taken by soft-deleted resources?

Not obvious, and it bites hard. Both names are built with
`uniqueString(resourceGroup().id)`, which is **deterministic** — the same
subscription plus the same resource-group name always produces the same
result. If this template, or anything resembling it, ran in this subscription
before, the names will collide.

Key Vault is the dangerous one: ours has **purge protection**, so a soft-deleted
vault of the same name blocks creation for 90 days and cannot be hurried.

```bash
az keyvault list-deleted --query "[].{name:name, location:properties.location, purgeOn:properties.scheduledPurgeDate}" -o table
az cosmosdb list-deleted 2>/dev/null || echo "(no deleted-account listing available on this CLI version)"
```

Anything named `kv-mspc-*` or `cosmos-mspc-*` here needs resolving before
deploying. A soft-deleted vault with purge protection **cannot be purged early**
— the fallback is to change `appName` or the resource-group names so
`uniqueString` produces something different.

### Does this subscription actually offer New Zealand North?

Region availability is per-subscription and depends on the offer type. It was
confirmed against a *different* subscription, so confirm it against this one —
the whole data-residency decision rests on it.

```bash
az account list-locations --query "[?name=='newzealandnorth'].{name:name, display:displayName}" -o table

az provider show -n Microsoft.DocumentDB \
  --query "resourceTypes[?resourceType=='databaseAccounts'].locations[]" -o tsv | grep -i "New Zealand"
```

Empty output on either means the region is unavailable here. Newer regions
sometimes require enabling for older subscriptions — raise a support request
before falling back to `eastasia`, because the fallback is a data-residency
change and MSPC's to approve.

### What else is in there, and is it costing anything?

```bash
az resource list --query "[].{name:name, type:type, rg:resourceGroup, location:location}" -o table
az group list --query "[].{name:name, location:location}" -o table
az consumption usage list --top 20 --query "[].{date:usageStart, cost:pretaxCost, meter:meterDetails.meterName}" -o table 2>/dev/null \
  || echo "(no usage data - consistent with an unused subscription)"
```

An empty resource list and no usage history is what "never used" should look
like. Anything else, report it to MSPC before proceeding — a renewed
subscription may carry resources someone still depends on, and this runbook
creates resource groups and role assignments in it.

### Offer type, for the record

```bash
az account show --query "{name:name, state:state, tenant:tenantDefaultDomain}" -o json
az billing account list --query "[].{name:displayName, agreement:agreementType}" -o table 2>/dev/null || true
```

Sponsorship and credit-based offers can restrict SKUs and regions in ways a
pay-as-you-go subscription does not. If anything below fails with a quota or
"not available in this location" error, this is the first place to look.

---

## 0.6 Register the resource providers

Application Insights needs a Log Analytics workspace. A subscription that has
never used one has the provider unregistered, and the deployment then fails
**halfway through**, after creating most of the other resources.

```bash
az provider register --namespace Microsoft.OperationalInsights --wait
az provider register --namespace Microsoft.DocumentDB --wait
az provider register --namespace Microsoft.Web --wait
az provider register --namespace Microsoft.KeyVault --wait
az provider register --namespace Microsoft.Insights --wait   # usually already registered
```

**This is our job, not the IT provider's.** Contributor is enough to register a
provider, so as soon as they have granted access this runs from here.
[PROVISION.md](PROVISION.md) deliberately keeps their side to four tasks — they
bill MSPC by the hour, so anything we can do with the access they grant, we do.

---

## 1. Validate the templates

A second here beats two minutes of deployment failing on the same thing.

```bash
az bicep build --file bicep/main.bicep --stdout > /dev/null && echo OK
```

---

## 2. First deployment — no custom domain

The domain cannot validate until DNS points at the site, and the CNAME cannot be
written until the site exists. So the first pass deliberately leaves it off.

`COSMOS_KEY` does not exist yet either, and the app settings resource replaces
the whole collection, so pass a placeholder now and fill it in at step 4.

```bash
OBJECT_ID=$(azv ad signed-in-user show --query id -o tsv)

az deployment sub create \
  --name mspc-initial \
  --location eastasia \
  --template-file bicep/main.bicep \
  --parameters \
      appName=mspc \
      environment=prod \
      appLocation=eastasia \
      cosmosLocation=newzealandnorth \
      adminEmailDomains=mspc.org.nz \
      keyVaultAdminObjectId="$OBJECT_ID" \
      customDomain=''
```

**On the two regions.** They are deliberately different, and the split is the
whole point.

| | Static Web App + Function | Cosmos DB |
| --- | --- | --- |
| Region | `eastasia` (Hong Kong) | `newzealandnorth` (Auckland) |
| Why | Free plan exists in only five regions; East Asia is the only Asia-Pacific one | The data stays onshore |

**Why the data is onshore.** No *diagnosis* is stored — Firestore held `"MS"` or
`"PD"` against a named person and Cosmos holds `qualifies: true/false`. But
`groupTypes.shortValue` is `MS` or `PD`, so a person's group membership implies
their condition. That inference is unavoidable in a system built to run
attendance for condition-specific groups, so the data is treated as health
information about identifiable people and kept in New Zealand.

Confirmed available before choosing it:

```bash
az account list-locations --query "[?name=='newzealandnorth']" -o table
az provider show -n Microsoft.DocumentDB \
  --query "resourceTypes[?resourceType=='databaseAccounts'].locations[]" -o tsv | grep -i "New Zealand"
```

**The cost is latency, and it is real.** The Function is in Hong Kong, so every
Cosmos query pays a ~140 ms round trip. A request making four sequential queries
spends over half a second in flight. Keep the number of queries per request
down — `byIds` and `byFieldIn` in [repo.ts](src/server/repo.ts) exist for that,
and each one that replaces a loop removes a round trip rather than shortening it.

**Import headroom** still fits, but with nothing spare. At ~140 ms per round trip
and `DEFAULT_CONCURRENCY = 20`, 2,000 writes take roughly 14 s and need ~930 RU/s
against the 1,000 RU/s cap. Note that raising concurrency does **not** help here:
the two ceilings meet at almost exactly this point, so more in flight buys
throttling rather than speed. [concurrency.ts](src/server/concurrency.ts) has the
arithmetic. Above ~2,000 rows in one request, split the file.

⚠️ **One thing that cannot be verified in advance: whether the Cosmos free tier
is grantable in `newzealandnorth`.** Region availability is confirmed above, but
`enableFreeTier` can only be proven by creating the account. If it is refused,
the deployment fails at that step and creates nothing — redeploy with
`cosmosLocation=eastasia`, or accept a paid account onshore, which is MSPC's call
rather than a technical one. `totalThroughputLimit: 1000` caps the account at the
free grant either way, so a mistake cannot quietly start billing.

Pass both regions explicitly, and use the same values in every later deployment.

Capture the outputs:

```bash
SWA_NAME=$(azv deployment sub show -n mspc-initial --query properties.outputs.staticWebAppName.value -o tsv)
HOSTNAME=$(azv deployment sub show -n mspc-initial --query properties.outputs.defaultHostname.value -o tsv)
COSMOS=$(azv deployment sub show -n mspc-initial --query properties.outputs.cosmosAccountName.value -o tsv)
VAULT=$(azv deployment sub show -n mspc-initial --query properties.outputs.keyVaultName.value -o tsv)

echo "$SWA_NAME / $HOSTNAME / $COSMOS / $VAULT"
```

---

## 3. Put the Cosmos key in Key Vault

Key Vault is the **store of record**, not a runtime dependency. Managed Static
Web Apps functions have no managed identity and cannot resolve Key Vault
references, so the deployment reads from here and writes plain app settings.

```bash
COSMOS_KEY=$(azv cosmosdb keys list -n "$COSMOS" -g rg-mspc-data --query primaryMasterKey -o tsv)

# Into .env, never onto a command line where it lands in shell history.
printf 'COSMOS_KEY="%s"\n' "$COSMOS_KEY" >> .env

npm run kv-sync -- push "$VAULT"
npm run kv-sync -- check "$VAULT"
```

`check` asserts each secret is present, long enough, and free of carriage
returns and non-printable characters — without showing you the value.

---

## 4. Redeploy with every setting present

The `appsettings` resource **replaces the entire collection**. A secret added by
hand afterwards is deleted by the next deployment, and a parameter left out is
deleted too — not left alone. Every deployment must carry every secret.

```bash
COSMOS_KEY=$(azv keyvault secret show --vault-name "$VAULT" -n cosmos-key --query value -o tsv)
test -n "$COSMOS_KEY" || { echo "empty key - refusing to deploy"; exit 1; }

az deployment sub create \
  --name mspc-settings \
  --location eastasia \
  --template-file bicep/main.bicep \
  --parameters \
      appName=mspc environment=prod \
      appLocation=eastasia cosmosLocation=newzealandnorth \
      adminEmailDomains=mspc.org.nz \
      keyVaultAdminObjectId="$OBJECT_ID" \
      customDomain='' \
      cosmosKey="$COSMOS_KEY"
```

---

## 5. Wire up GitHub Actions

```bash
TOKEN=$(azv staticwebapp secrets list -n "$SWA_NAME" -g rg-mspc-prod \
          --query properties.apiKey -o tsv)

gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --body "$TOKEN"
gh variable set APP_URL --body "https://$HOSTNAME"

# Turns the deploy job on. Until this is "true" the workflow typechecks,
# tests and builds, then stops - see below.
gh variable set DEPLOY_ENABLED --body true
```

Push to `main`. The workflow typechecks, tests, builds, asserts
`dist/staticwebapp.config.json` exists, deploys, and then smoke tests.

### Why `DEPLOY_ENABLED` exists

Before this step there is nothing to deploy *to*, and the deploy job would fail
on every push with an empty deployment token. A pipeline that is always red is
one people stop reading, and the first genuine failure then goes unnoticed.

So the deploy job is gated on a repository **variable** — secrets are not
available to a job-level `if`, variables are. Until it is set, a push to `main`
runs the full build and test and stops there, green.

It doubles as a deploy freeze: set it to anything other than `true` and pushes
keep being verified without shipping.

```bash
gh variable set DEPLOY_ENABLED --body false   # freeze
gh variable list                              # check
```

Note that the smoke job `needs: deploy`, so it is skipped along with it rather
than testing a deployment that never happened.

### If the deploy fails with "Function language info isn't provided"

`staticwebapp.config.json` is being read from the repository root, where it is
**ignored**. It has to be inside the uploaded artifact — `dist/`. In Vite that
means it lives in `public/`. `platform.apiRuntime` lives in that file and with
Oryx skipped there is nothing else to detect the language from. The CI job
checks for this so it fails with a message that says so.

### `skip_api_build` warning

`Azure/static-web-apps-deploy@v1` logs `Unexpected input(s) 'skip_api_build'`.
It is passed to the container as `INPUT_SKIP_API_BUILD` and honoured — look for
`Skipping step to build /github/workspace/api with Oryx`. Ignore the warning.

---

## 6. Load the data — the initial Infoodle load *is* the migration

**The Cosmos containers start empty, and that is deliberate.** There is no
Firestore migration step, because there was nothing worth migrating: the
Firebase app was never live, and its Firestore held 53 test people, 47 test
events, 40 event ids fabricated by the old `uuidv4()` code, no real Infoodle ids
and no access code anybody was holding. A migration script was written, run as a
dry run, and then dropped. It is in git history if it is ever wanted.

So the data lifecycle has two phases, and only the first is a one-off:

```
   initial load from Infoodle   ->   the migration equivalent, once
   updates from Infoodle        ->   deltas, ongoing
```

Nobody's magic link breaks, because nobody has one. No admin record carries
over — you create the first one in step 7.

### If the API is not available yet

It is not, at the time of writing. [INFOODLE-CSV.md](INFOODLE-CSV.md) specifies
the Infoodle queries to export instead, the exact CSV columns the importer
expects, and the order to load them in. The three files carrying no personal
data — `groupTypes`, `groups`, `events` — go first and prove the whole path
before any names move.

### Phase 1: the initial load

This is the bulk event, and the one the platform limits actually bite on:

| Limit | Value | Where it bites |
| --- | --- | --- |
| Static Web Apps request | **45s**, not raisable | one import request |
| Cosmos free tier | **1,000 RU/s** account-wide | total write time |
| Infoodle API | **500 requests/hour** | reading it out of Infoodle |

At ~7 RU per write, 2,000 people is ~14,000 RU — about **14 seconds**, which
fits. That is only true because imports write concurrently and record one audit
row per import rather than one per row; see `src/server/concurrency.ts` for the
arithmetic. Above roughly 2,000 rows in a single request, revisit it.

Reading the other side, Infoodle has **no "list all people"** endpoint — page
through `people/search` or `people/directorysearch`. With 500 requests/hour, a
full pull of people plus per-group members plus per-event rosters is comfortable
once and unpleasant to repeat, so cache what you fetch while developing.

### Phase 2: updates only

`people/poll_new` looks purpose-built for this and is the right primitive — far
cheaper against the rate limit than re-pulling everything. Prefer it to a
scheduled full re-sync.

### Before writing anything back to Infoodle

The API model lines up closely with this app's — `grouptypes/list`,
`groups/members`, `people/search`, `events/bydate`, `groups/membersforevent`, and
`POST /groups/attendance/{groupid}/{eventid}/{eventdate}` — but three gaps need
a decision rather than a guess:

- **`no-show` does not map.** Infoodle records `-1` not checked in / `0` checked
  out / `1` checked in. This app's `no-show` and `unknown` both collapse to `-1`.
- **`rsvpStatus` has no representation at all.** Attendance can be written back;
  booking cannot, at least not through that endpoint.
- **`infoodleId` is absent unless usable.** The app no longer invents one, and
  rejects anything that is not an integer at import — see
  `src/server/external-id.ts`. Shape is not provenance, though: a fabricated
  *integer* passes validation and then addresses somebody else's record, which is
  worse than a wrong-shaped id that fails loudly. That is also why the profile
  `unique_id` lives in its own field, `infoodleUniqueId`, and never in
  `infoodleId`.

Auth is OAuth2 against a per-site host, `https://YOURSITE.infoodle.com/apiv2/…`,
using a **user's** login plus a client secret from that user's account screen.
Access inherits that user's role and permissions, so test with a record you
expect to be able to read — a 200 from a small endpoint proves very little.

[INFOODLE-API.md](INFOODLE-API.md) has every call field by field. Read its first
section before writing the loader: Infoodle has **two different person
identifiers**, `unique_id` and `userId`, and attendance write-back needs the one
that `people/search` does not return.

---

## 7. Create the first admin

Chicken and egg: admin routes require an `admins` record, and there is no UI for
creating the first one. Do it directly, once.

```bash
az cosmosdb sql container create --help >/dev/null   # containers already exist

# Use the portal's Data Explorer, or:
node --input-type=module -e '
import { CosmosClient } from "@azure/cosmos";
const c = new CosmosClient({ endpoint: process.env.COSMOS_ENDPOINT, key: process.env.COSMOS_KEY });
await c.database(process.env.COSMOS_DATABASE).container("admins").items.upsert({
  id: "you@mspc.org.nz", email: "you@mspc.org.nz", role: "superadmin",
  createdAt: new Date().toISOString()
});
console.log("done");
'
```

The `id` **must** be the lowercased email address. Both checks have to pass: the
domain must be in `ADMIN_EMAIL_DOMAINS` *and* the record must exist.

---

## 8. Verify

```bash
curl -s "https://$HOSTNAME/api/health"
# {"status":"ok","message":"Cosmos DB connected"}

npm run smoke -- "https://$HOSTNAME"
```

The smoke tests assert the API **refuses** anonymous callers. A 200 from
`/api/admin/backup` without a principal means the whole database is public;
that check failing is the one that matters.

Then sign in at `https://$HOSTNAME` and confirm you reach the Dashboard.

### If the app loads but shows nothing

The client is served to everybody — it has to be, because magic links must
reach it without a session. So "the shell loads, populated with nothing" is what
a staff member with no session sees, and it is not a broken deployment. The app
distinguishes the cases explicitly: it will say *not signed in*, *not an
administrator*, or *could not reach the API*, which are three different
problems.

---

## 9. Custom domain — the second pass

Now that the site exists and has a hostname:

1. At the DNS provider for `mspc.org.nz`, add:

   ```
   app.mspc.org.nz.   CNAME   <the value of $HOSTNAME>
   ```

   MSPC's IT provider makes this change — send them the literal value of
   `$HOSTNAME`, not a description of it. [PROVISION.md](PROVISION.md) §3 is
   their copy, including the CAA and proxied-DNS checks that fail *after*
   validation and are easiest to rule out beforehand.

2. Wait for it to resolve: `nslookup app.mspc.org.nz`

3. Deploy again, this time with the binding on:

   ```bash
   az deployment sub create \
     --name mspc-domain \
     --location eastasia \
     --template-file bicep/main.bicep \
     --parameters \
         appName=mspc environment=prod \
         appLocation=eastasia cosmosLocation=newzealandnorth \
         adminEmailDomains=mspc.org.nz \
         keyVaultAdminObjectId="$OBJECT_ID" \
         customDomain=app.mspc.org.nz \
         cosmosKey="$COSMOS_KEY"
   ```

4. Update the smoke target: `gh variable set APP_URL --body "https://app.mspc.org.nz"`

---

## Running costs

| Resource | Plan | Cost |
| --- | --- | --- |
| Static Web Apps | Free | $0 — 100 GB bandwidth/month, custom domain and TLS included |
| Cosmos DB | Free tier | $0 — first 1000 RU/s and 25 GB, one account per subscription |
| Application Insights | Pay-as-you-go | $0 in practice — 5 GB/month free, this app sends far less |
| Log Analytics | Pay-as-you-go | $0 in practice — same 5 GB allowance, 30-day retention |
| Key Vault | Standard | Fractions of a cent — priced per 10,000 operations |

`totalThroughputLimit: 1000` on the Cosmos account caps it at the free grant, so
a mistake in a container definition cannot quietly start billing.

**Watch for:** a Cosmos account created *without* `enableFreeTier` bills from the
first read, and the flag can only be set at creation — an account made without
it has to be recreated, not converted.
