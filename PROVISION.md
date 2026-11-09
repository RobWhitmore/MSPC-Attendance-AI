# Provisioning MSPC Attendance — instructions for MSPC's IT provider

Setting up the production environment for MSPC's attendance application at
**https://app.mspc.org.nz**.

**We have kept your involvement to four short tasks, plus one two-minute DNS
change a few days later.** Everything else is done by MSPC's developer once you
have granted access. Nothing here is open-ended: every step has an exact command
or click-path, and we have already checked everything that could be checked from
outside your tenant.

Total expected time: **20–30 minutes.** The variable is the credit and billing
setup in task 1, which is entirely on your side of the fence.

---

## What we need from you

| # | Task | Time | Why it has to be you |
| --- | --- | --- | --- |
| 1 | Create the subscription and apply the credits | ~10 min | Billing ownership |
| 2 | Grant our developer **Owner** on it | ~2 min | Only an owner can delegate |
| 3 | Create one unlicensed `@mspc.org.nz` account | ~3 min | User administration |
| 4 | Confirm the app-consent setting | ~2 min | Tenant-level policy |
| 5 | *Later:* add one DNS record in Cloudflare | ~2 min | You hold the zone |

### 1. Create — or confirm — the subscription

- **Dedicated to this application**, in the **same Entra tenant that owns
  `mspc.org.nz`**.
- Apply the MSPC credits to it.
- Suggested name: `MSPC Attendance — Production`.

> **It must stay empty until we deploy — please do not create any resources in
> it, a Cosmos DB account least of all.**
>
> Azure grants the Cosmos DB free tier (1,000 RU/s and 25 GB) **once per
> subscription**, and the flag that claims it can only be set at the moment the
> database is created. If anything claims it first, it cannot be converted
> afterwards — the account has to be destroyed and rebuilt, which is a second
> call-out rather than a setting change.

**If you are renewing an existing subscription rather than creating a new one,**
please tell us — we understand this may be the case. It changes nothing you need
to do, but we will check three things before deploying, because they are not
recoverable afterwards:

- whether the Cosmos DB free-tier grant has already been used;
- whether any **soft-deleted** Key Vault or Cosmos account is still holding a
  name (a deleted vault can reserve its name for 90 days);
- whether anything already in the subscription is still in use by someone.

If you already know the answers, sending them saves us a round trip. If not, we
can check it ourselves once task 2 is done.

Send us the **subscription ID** and the **tenant ID**.

### 2. Grant Owner to our developer

Scoped to this subscription only. No access to any other subscription, mailbox,
SharePoint site, or tenant resource is needed.

```bash
SUB="<the new subscription id>"
az role assignment create \
  --assignee "rob@mspc.org.nz" \
  --role Owner \
  --scope "/subscriptions/$SUB"
```

Or in the portal: **Subscriptions → (the new one) → Access control (IAM) → Add
role assignment → Owner**.

If Owner is not acceptable under your policy, **Contributor + User Access
Administrator** together are exactly equivalent for our purposes and we are
happy with that instead. Elevated rights are needed because the deployment
creates one role assignment — Key Vault Secrets Officer on the app's own
vault — and Contributor alone cannot create role assignments.

**Granting this early is what removes work from you.** Everything in "What we
handle" below becomes ours the moment it exists.

### 3. Create one account

An `@mspc.org.nz` account for **Rob Whitmore**, MSPC's developer.

- A **member** account, not a guest. Guests cannot administer the app — it
  translates a guest's tenant UPN back to their external address, which then
  fails the domain check by design.
- **No M365 licence required.** An unlicensed member signs in perfectly well for
  this app, so there is no licence cost.
- Happy for it to be time-boxed or disabled after handover — tell us the date and
  we will ensure a licensed MSPC staff administrator exists before then.

### 4. Confirm the consent setting

**Entra admin centre → Enterprise applications → Consent and permissions → User
consent settings.**

Staff sign in through Static Web Apps' built-in Entra provider, a
Microsoft-managed application. **There is nothing to register**, no client secret
to rotate, and no redirect URIs to maintain. It requests basic sign-in only
(`openid`, `profile`, `email`) — no mail, files, SharePoint or directory access.

If user consent is turned off, the first person to sign in sees **"Need admin
approval"** and stops. Either is fine:

- Allow user consent for apps with low-impact permissions, or
- Have a Global Administrator or Cloud Application Administrator approve once at
  the first prompt, choosing **Consent on behalf of your organization**.

Just tell us which, so we know what the first sign-in will look like.

### 5. Later — one DNS record in Cloudflare

We will send you the exact target once the site exists. It cannot be known
before then: Azure validates the domain by reading DNS, but the hostname does
not exist until the site is deployed. There is no way to collapse the two.

```
Type:    CNAME
Name:    app
Target:  <we will send this — something.azurestaticapps.net>
Proxy:   DNS only  ← grey cloud, NOT proxied
TTL:     Auto
```

> ⚠️ **The proxy must be off, and Cloudflare defaults new records to on.**
>
> We can see that `mspc.org.nz` itself is proxied (orange cloud), so this will be
> the opposite of the normal habit for this zone. A proxied record breaks both
> Azure's CNAME-delegation validation **and** its managed certificate issuance —
> and the certificate failure happens *after* validation appears to succeed,
> which makes it a confusing thing to diagnose later.
>
> This is the single most likely cause of a second visit, so it is worth the
> extra two seconds to check the cloud is grey.

Azure then issues and renews a free TLS certificate automatically. No CSR, no
purchase, no renewal task. Please leave the record DNS-only permanently — turning
the proxy on later would break certificate renewal weeks after the change.

---

## What we handle, so you do not have to

Once task 2 is done, all of this is ours:

- Registering the resource providers
- Creating every resource, and all deployments
- Key Vault and secret handling
- Budget alerts and cost monitoring
- Creating administrator records for MSPC staff
- The custom domain binding and all verification

We will also tell you if anything unexpected needs your attention, rather than
you needing to check.

## Already checked — nothing needed from you

We resolved these from public DNS so they are not questions for you:

| Check | Result |
| --- | --- |
| Who hosts DNS for `mspc.org.nz` | **Cloudflare** (`leonidas` / `kelly` nameservers) |
| CAA records restricting certificate issuance | **None** — nothing to change |
| Is `app.mspc.org.nz` already in use | **No** — the name is free |
| Would this affect the main website | **No** — apex and `www` are untouched |

## Not required

Listed to be clear about the scope of access we are asking for:

- No virtual machines, App Service plans, SQL servers, or storage accounts
- No VNet, subnets, NSGs, firewall rules, private endpoints, or VPN
- No on-premises integration, and no SharePoint or Teams configuration
- No TLS certificate purchase, CSR, or renewal process
- No changes to MX, SPF, DKIM or DMARC — **the application sends no email**
- No changes to the existing website, apex, or `www`
- No Global Administrator role for us — subscription Owner on the **new
  subscription only**, plus one ordinary unlicensed user account
- No access to any existing MSPC subscription, mailbox, or tenant data

---

## Reference

Everything below is background. It needs no action.

### Regions

Two, deliberately:

| Resource group | Region | Why |
| --- | --- | --- |
| `rg-mspc-data` | **New Zealand North** (Auckland) | The database stays onshore |
| `rg-mspc-prod` | **East Asia** (Hong Kong) | The web app's free plan exists in only five regions worldwide, none nearer |

**The database is in New Zealand on purpose.** It stores names, contact details,
group membership and attendance. No diagnosis is recorded — the application
deliberately keeps only a yes/no eligibility flag — but the groups themselves are
condition-specific, so knowing someone attends a particular group implies which
condition they have. That inference is unavoidable in a system for running
attendance at condition-specific support groups, so the data is treated as
health-related and kept in the country. **It cannot be moved later without
rebuilding the database.**

**The web app cannot follow it.** Azure Static Web Apps' free plan exists in only
five regions — Central US, East US 2, West US 2, West Europe and East Asia — and
East Asia is the only one in Asia-Pacific. That is a platform constraint. The
application code runs there and reads the New Zealand database; no personal data
is stored in Hong Kong.

⚠️ **If you enforce an allowed-locations Azure Policy, this subscription needs
both regions permitted.** Please tell us if either is a problem rather than
working around it.

### What will be created

| Resource group | Resource | Type | Plan |
| --- | --- | --- | --- |
| `rg-mspc-prod` (East Asia) | `stapp-mspc-prod` | Static Web App | Free |
| | `appi-mspc` | Application Insights | Pay-as-you-go, 5 GB/month free |
| | `log-mspc` | Log Analytics workspace | Pay-as-you-go, 30-day retention |
| `rg-mspc-data` (New Zealand North) | `cosmos-mspc-…` | Cosmos DB (NoSQL) | Free tier |
| | `kv-mspc-…` | Key Vault | Standard |

The Cosmos account is capped at the free grant of 1,000 RU/s in the template, so
a configuration mistake cannot quietly start billing.

The Key Vault has **purge protection** enabled: if deleted it cannot be
hard-deleted for 90 days, and its name stays reserved. Deliberate, but it means
"delete it and redeploy" is not available as a quick fix.

### Conditional Access

An ordinary browser sign-in, so existing MFA and Conditional Access policies
apply — and we want them to. If a policy restricts access by approved client app
or cloud-app allowlist, it will need to permit this sign-in. If a staff member is
blocked, send us the **Correlation ID** from the Entra sign-in log entry.

### Running costs

| Resource | Plan | Cost |
| --- | --- | --- |
| Static Web Apps | Free | $0 — 100 GB bandwidth/month, custom domain and TLS included |
| Cosmos DB | Free tier | $0 — first 1,000 RU/s and 25 GB |
| Application Insights | Pay-as-you-go | $0 in practice — 5 GB/month free |
| Log Analytics | Pay-as-you-go | $0 in practice — same allowance, 30-day retention |
| Key Vault | Standard | Fractions of a cent — priced per 10,000 operations |

The credits are headroom, not the funding model. If this subscription starts
showing meaningful spend, something is misconfigured and we would want to know.

### What to send back

| Item | |
| --- | --- |
| Subscription ID | Of the new, empty subscription |
| Tenant ID or primary domain | To confirm the right tenant |
| Access confirmed | Owner, or Contributor + User Access Administrator |
| Rob's `@mspc.org.nz` address | Plus invite or temporary password |
| Consent decision | User consent enabled, or an admin will approve at first sign-in |
| Administrator list | The `@mspc.org.nz` addresses of staff who should administer the app |

The first four unblock everything. The DNS record follows a few days later.
