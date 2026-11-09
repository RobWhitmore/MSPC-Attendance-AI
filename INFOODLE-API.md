# Infoodle API — the calls this app needs

Taken from the Infoodle OpenAPI spec, **version 2.1.1**. Every endpoint below is
`GET` unless marked otherwise, and is relative to:

```
https://YOURSITE.infoodle.com/apiv2/
```

Read [DEPLOY.md §6](DEPLOY.md) for how these fit the two-phase load. This
document is the field-level detail behind it.

---

## Before the endpoint list: two things that shape the design

### 1. There are two different person identifiers, and they are not interchangeable

This is the most important thing on this page.

| Identifier | Returned by | Used by |
| --- | --- | --- |
| `unique_id` | `people/search`, `people/directorysearch`, `people/poll_new` | `people/{unique_id}`, `group/memberships/uniqueid/…` |
| `userId` | `groups/members`, `groups/membersforevent` | **`POST groups/attendance`**, `group/memberships/{id}/{groupid}` |

The spec states the distinction outright on `POST /group/memberships/{id}/{groupid}`:

> Identify the contact by their internal **user id**. If you only have a
> `unique_id`, use `/group/memberships/uniqueid/{uniqueid}/{groupid}` instead.

and describes that `id` parameter as *"the `userId` returned by `groups/members`
and similar endpoints"*.

**How this app handles it:** a person document holds **two separate fields**, so
which number is which is never inferred.

| Field | Holds | Source |
| --- | --- | --- |
| `infoodleId` | internal `userId` | `groups/members`, `groups/membersforevent` |
| `infoodleUniqueId` | profile `unique_id` | `people/search`, `poll_new`, CSV exports |

Both are integers, so no validator can distinguish them — **only the field they
are written to can**. `acceptInfoodleId` in
[external-id.ts](src/server/external-id.ts) therefore validates shape and
nothing more, and each import path names the field it is writing to.

The failure this prevents is not a crash. It is a plausible integer sitting in
`infoodleId`, passing every check, and posting attendance against a real but
unrelated person.

**Still to decide** before the initial load: where people come from.

- **`groups/members`** gives the `userId` attendance needs directly, and is
  cheaper — 200 per page against `people/search`'s 30. The cost is that anyone
  in no group is never seen.
- **`people/search`** sees everyone but yields only `unique_id`, so
  `infoodleId` stays empty until a later pass fills it in from
  `groups/members`.

Nothing in the spec returns both in one payload, so a pairing pass is needed
either way if both are wanted. Confirm against the live API before loading
anything.

### 2. Rate limits are tighter per-minute than per-hour

```
30 requests per minute          <- the binding constraint on a bulk load
100 requests within 5 minutes
500 requests within 1 hour
5,000 requests within 1 day
```

Exceeding any of these returns **429 Too Many Requests**. Unauthenticated
limits are lower still (10/min, 30/5min, 150/hour, 1500/day).

The per-minute ceiling, not the hourly one, is what paces the initial load. It
also makes page size matter a great deal:

| Source of people | Page size | Requests for ~2,000 people |
| --- | --- | --- |
| `groups/members` | 200 | ~10 per group |
| `people/search` | 30 | ~67 |

**Tokens expire after 30 minutes**, so a load that paces itself against the
per-minute limit will outlive its token. Use the refresh flow
(`/apiv2/oauth2/refresh`) rather than assuming one token covers the run.

---

## Authentication

OAuth2 authorization code, against a per-site host. The credentials are a
**user's** login plus a client secret from that user's own account screen.

```
GET  /apiv2/oauth2/authorise    client_id, redirect_uri, response_type=code
POST /apiv2/oauth2/authorise    ... plus authorized=yes   -> code in Location header
POST /apiv2/oauth2/token        grant_type=authorization_code, code,
                                client_secret, client_id, redirect_uri
```

Then `Authorization: Bearer <token>` on every call.

**Access inherits that user's role and permissions.** A 200 from a small
endpoint proves very little — the same call as a differently-permissioned user
returns a different subset. Test with a record you expect to be able to read,
and with one you expect to be refused.

---

## Phase 1 — the initial load

### Group types → `groupTypes`

```
GET /grouptypes/list
```

**Request:** no parameters.

**Response:** array of

| Field | Type | Notes |
| --- | --- | --- |
| `id` | integer | Use in other calls |
| `name` | string | e.g. `Program Groups` |
| `groupCount` | integer | Active + hibernated + expired |

### Groups → `groups`

```
GET /groups/list/{limit}/{limitvalue}
```

**Request:** two parallel comma-separated lists that must have the same number
of entries. `limit` names the filters, `limitvalue` supplies their values.

| `limit` key | Value |
| --- | --- |
| `group_type` | Group type id |
| `parent` | Parent group id to start from |
| `action` | `Y` / `N` |
| `visible` | `Y` / `N` |
| `content` | `Y` / `N` |
| `name` | Group name, case-insensitive |

Example: `/groups/list/parent,visible/310,Y`

**Response:**

| Field | Type | Notes |
| --- | --- | --- |
| `groups[]` | array | Nested — see `child_groups` |
| `groups[].id` | integer | |
| `groups[].name` | string | |
| `groups[].group_type` | object | `{ id, name }` |
| `groups[].locked` | `Y`/`N` | Administrators only |
| `groups[].can_see_content` | `Y`/`N` | |
| `groups[].can_do_tasks` | `Y`/`N` | |
| `groups[].membership` | object | `code` `A`/`F`/`V`/`P`, `text` — **the authenticated user's** level, not a member's |
| `groups[].use_as_visible_to` | `Y`/`N` | |
| `groups[].child_groups[]` | array | Same shape, recursive |
| `total_top_level_groups_shown` | integer | |
| `total_groups_shown` | integer | |

Note the hierarchy: this app's `groups` container is flat, so child groups need
either flattening or a parent reference adding. `groups/flatlist/{limit}/{limitvalue}`
exists if the nesting is unwanted.

### People → `people`

```
GET /people/search/{searchmethod}/{query}/{page}
```

**There is no "list all people" endpoint.** The closest is `searchmethod=all`,
which ignores `query` — pass `*`.

| Parameter | Notes |
| --- | --- |
| `searchmethod` | `all`, `name`, `id`, `email`, `phone`, `postcode`, `country`, `hhname`, `hhid`, `address`, `givenum`, `BA`, `CC`, `RF`, `archived` |
| `query` | Search term; ignored for `all` and `archived` |
| `page` | Page number; **30 records per page** |

`error:2` is returned when there is nothing left to return — that is the
end-of-pagination signal, not a failure.

**Response** — the `User` schema, `{ people: [...] }`, each person carrying:

| Field | Type | Maps to |
| --- | --- | --- |
| `unique_id` | integer | ⚠️ *not* the id attendance needs — see above |
| `url` | string | Profile link |
| `title` | string | |
| `firstname`, `middlename`, `lastname` | string | `name` |
| `organisationcontact` | `Y`/`N` | |
| `gender` | `Male`/`Female`/`ORGANISATION` | |
| `archived` | | Excluded by default |
| `gift_aid` | object | Not used |
| `phone[]` | array | `{ for: PERSONAL\|ORGANISATION, id, type, value }` |
| `cell[]` | array | `{ id, type, value }` → `phone` |
| `email[]` | array | `{ id, type, value, active: 0\|1 }` → `email` |
| `person_image` | string | Base64 — **large**; a real cost on a 2,000-row pull |
| `address` | object | |
| `date_time_changed_utc` | string | |
| `notes[]` | array | |
| `person_custom_fields[]` | array | **Where eligibility will live** — see below |
| `household_custom_fields[]` | array | |
| `connected[]` | array | Connected **people**, `{ unique_id, name, type, gender, organisationContact, person_image }` |
| `alternate[]`, `alternateAddresses[]` | array | Alternate households |
| `canEdit` | | |
| `last_updated_datetime_utc` | string | |
| `lastUpdatedDatetimeUtcShowLocal` | string | |

Two things to note:

- **`connected` is connected *people*, not groups.** The person payload carries
  no group membership at all. Membership comes from `groups/members`
  (group-first) or `group/memberships/uniqueid/{uniqueid}` (person-first, one
  request each — 2,000 requests for 2,000 people, so not viable inside the rate
  limit).
- **`qualifies` has no native field.** It comes from `person_custom_fields`, so
  the field id has to be identified on the live site first —
  `GET /customfield/list` enumerates them.

  The right target is a **dedicated Yes/No field** (`field_type: '2'`), not the
  condition field itself. Reading the diagnosis and reducing it here means the
  diagnosis crosses the wire and sits in memory on every sync, for a boolean we
  could have been given directly. [INFOODLE-CSV.md](INFOODLE-CSV.md) proposes
  creating that field for the CSV route; if it exists by the time the API is
  wired up, this reads it and never sees a condition at all.

`people/directorysearch/{searchby}/{value}/{page}` returns a lighter payload —
`unique_id`, `url`, `title`, names, `organisationcontact`, `gender`, `phone[]`,
`cell[]`, `email[]`, `person_image`, `last_updated_datetime_utc`. It carries no
custom fields, so it is not enough for the initial load.

### Group membership → `groupMembers`

```
GET /groups/members/{groupid}/{page}
```

**Request:** `groupid`, `page`. **Up to 200 per page** — far cheaper than
`people/search`.

**Response:**

| Field | Type | Notes |
| --- | --- | --- |
| `groupId` | integer | |
| `members[].userId` | integer | ✅ the id `POST groups/attendance` wants |
| `members[].firstname`, `middlename`, `lastname` | string | |
| `members[].gender` | `Male`/`Female`/`ORGANISATION` | May be empty |
| `members[].householdname` | string | Use when `isOrganisation` is `Y` |
| `members[].isOrganisation` | `Y`/`N` | |
| `members[].membership.code` | `A`/`F`/`V`/`P` | |
| `members[].membership.text` | `Administrator` / `Full member` / `View only` / `Past member` | |

`membership.code` is the natural source for this app's group role. `A` →
`leader` is the obvious mapping; `P` (past member) should probably not import as
a member at all.

### Events → `events`

```
GET /events/bydate/{from_date}/{to_date}/{location}
```

⚠️ **The spec documents this path twice, with conflicting `location`
semantics.** One entry types it as an integer location id with `0` for all; the
other as an enum. Test which the live site honours before relying on either.

| `location` (enum form) | Meaning |
| --- | --- |
| `mine` | Events the authenticated user is connected to |
| `mineandpublic` | As `mine`, plus internet-visible |
| `rostered` | Events they are rostered onto |
| `public` | Internet-visible only |
| `all` | All |
| `ids` | Requires location ids in a further parameter |

Dates are `YYYY-MM-DD`, **local time**.

**Response:** `events` carrying, per occurrence:

| Field | Type | Maps to |
| --- | --- | --- |
| `id` | integer | Event id |
| `date` | string | `YYYY-MM-DD` — the occurrence |
| `title` | string | |
| `description` | string | |
| `startTime24hr`, `endTime24hr` | string | |
| `setupTime24hr`, `packDownTime24hr` | string | |
| `dayNumber`, `dayNumberTh`, `dayName`, `dayNameAbbr`, `monthName`, `monthNameAbbr`, `yearNumber` | mixed | Pre-formatted; ignore |
| `setupTimeFriendly`, `startTimeFriendly`, `endTimeFriendly`, `packDownTimeFriendly` | string | Pre-formatted; ignore |
| `allDay` | 0/1 | |
| `bookingFormId` | integer | |
| `show_as_current` | `Y`/`N` | On now |
| `passRequired` | `Y`/`N` | COVID pass; not used |
| `locationsDecode[]` | array | `{ id, name, address }` |
| `webLink` | string | |
| `colorCode` | string | |
| `availableInvitees[]` | array | `{ id, name }` — the groups invited |

**An event is identified by `id` *plus* `eventdate`.** Repeating events share
one id across occurrences, and every attendance call takes both. This app's
`events` container is partitioned by `/groupId` with its own id — the Infoodle
pair needs storing as two fields, not one.

For a single occurrence in full:

```
GET /events/event/{eventid}/{eventdate}
```

Adds `nextEvent`, `questions`, `hasRoster` (`Y`/`N`), `hasLiveEvent`,
`inviteesHasAdmin`, `inviteesHasCanAdmin`, and a richer `invitees[]`:

| Field | Type |
| --- | --- |
| `invitees[].group_id` | integer |
| `invitees[].name` | string |
| `invitees[].isadmin` | `Y`/`N` |
| `invitees[].canadmin` | `Y`/`N` |
| `invitees[].attendanceCapacity` | number |

### Rosters → `rosters`

```
GET /groups/membersforevent/{groupid}/{eventid}/{eventdate}/{type}/{page}
```

The group **must be one of the groups invited in the event settings**, or this
returns nothing useful.

| Parameter | Notes |
| --- | --- |
| `groupid`, `eventid` | integers |
| `eventdate` | `yyyy-mm-dd`, the occurrence |
| `type` | Filter — `all` / `registered` / `attended` |
| `page` | Starts at **0** (note: `groups/members` pages differently) |

**Response:**

| Field | Type | Notes |
| --- | --- | --- |
| `groupId` | integer | |
| `members[].userId` | integer | |
| `members[].attendanceId` | integer | `0` when none yet; needed for visitors |
| `members[].firstname`, `middlename`, `lastname`, `nickName` | string | |
| `members[].notes` | string | |
| `members[].gender` | `Male`/`Female`/`ORGANISATION` | |
| `members[].householdname` | string | |
| `members[].isOrganisation` | `Y`/`N` | |
| `members[].passExpiryDate` | string | |
| `members[].membership` | object | `code` `A`/`F`/`V`/`P`, `text` |
| `members[].type` | `member` / `visitor` | |
| `members[].status` | `-1` / `0` / `1` | −1 not checked in or out, 0 checked out, 1 checked in |

This is the closest match to the app's roster: one row per person per event
occurrence, carrying attendance state.

---

## Phase 2 — updates only

```
GET /people/poll_new
```

**Request:** no parameters — and that is the whole point. Infoodle records the
user and timestamp of each poll, so the next call by *the same user* returns
what changed since. One request, no date arithmetic.

**Response:** the same `User` schema as `people/search`.

Two implications worth planning around: the cursor is **server-side and
per-user**, so sharing the service account across a dev machine and production
means each consumes the other's deltas; and there is no way to replay, so a
failed run loses the window. If that matters, record the ids seen before acting
on them.

---

## Writing back to Infoodle

### Attendance

```
POST /groups/attendance/{groupid}/{eventid}/{eventdate}
```

**Request body** — a single `attendance` parameter holding a JSON array:

```json
{
  "attendance": [
    { "type": "member",  "userId": 114177, "status": 1 },
    { "type": "visitor", "attendanceId": 1123,
      "firstName": "James", "lastName": "Malone",
      "notes": "A note up to 512 chars long",
      "status": 1, "passExpiryDate": "2022-06-01" }
  ]
}
```

| Field | Applies to | Notes |
| --- | --- | --- |
| `type` | both | `member` or `visitor` |
| `userId` | member | The `userId` from `groups/members` — **not** `unique_id` |
| `attendanceId` | visitor | From `groups/membersforevent` |
| `firstName`, `lastName` | visitor | |
| `notes` | visitor | ≤ 512 characters |
| `status` | both | **`1` = check in, `0` = check out** |
| `passExpiryDate` | visitor | Optional |

**Responses:** `200 OK` with no body. `400` returns
`[{ "error": "Invalid parameters. attendance data is invalid" }]`.

Three gaps between this and what the app records:

- **The write accepts only `1` or `0`.** The read returns `-1` as well ("not
  checked in or out"), but there is no documented way to *write* −1. So a state
  can be observed that cannot be restored — you can check someone in or out, but
  not put them back to untouched.
- **`no-show` does not map.** This app's `no-show` and `unknown` both collapse
  toward −1, which is unwritable. Attendance write-back can therefore express
  "attended" and "left", and nothing else.
- **`rsvpStatus` has no representation at all.** Attendance can be written;
  booking cannot, at least not through this endpoint.

### Group membership

```
POST /group/memberships/{id}/{groupid}                      (id = userId)
POST /group/memberships/uniqueid/{uniqueid}/{groupid}       (unique_id)
```

Requires **Groups Edit** permission on the target group.

**Body** (`GroupMembershipBody`, all optional):

| Field | Type | Notes |
| --- | --- | --- |
| `date_joined` | string | ISO `yyyy-mm-dd` safest; defaults to today on a new membership |
| `date_left` | string | Set with `permission=P` to record a past member |
| `permission` | `P`/`V`/`F`/`A` | Past / View only / Full member / Administrator. **Defaults to `V` if omitted** |
| `parent_permission` | `P`/`V`/`F`/`A` | Level applied at the parent group |
| `function` | integer | `group_function` lookup id |
| `team_skill` | string | Comma-separated `team_skill` lookup ids |
| `volunteer_hours` | integer | |
| `volunteer_hours_multiplier` | `''`/`yr`/`qtr`/`mth`/`wk` | |

**Response:**

| Field | Type | Notes |
| --- | --- | --- |
| `ok` | integer | `1` |
| `connection_id` | integer | |
| `added_older_connection` | boolean | True when the saved record predates the live membership, so only history changed |

That last field matters: a `true` means the write did **not** change current
membership, only history. Treating a 200 as "membership updated" would be wrong.

**Reading back:**

```
GET /group/memberships/{id}/{groupid}          one membership
GET /group/memberships/{id}                    all for a user id
GET /group/memberships/uniqueid/{uniqueid}     all for a unique_id
```

The spec documents no response schema for these — only `200 OK`. Shape has to be
established against the live site.

---

## Supporting calls

| Endpoint | Why |
| --- | --- |
| `GET /global/ping` | Cheapest liveness and token check |
| `GET /global/mysettings` | Confirms which user the token belongs to and what it can see |
| `GET /customfield/list` | Find the custom field backing `qualifies` |
| `GET /roles/list` | `{ id, name, usage }` — needs the List Roles permission |
| `GET /location/list` | Event locations |

---

## Open questions to settle against the live site

Before the initial load, not after:

1. **Which id does MSPC's data actually expose, and how do `unique_id` and
   `userId` relate?** Everything else depends on this.
2. **Which `location` form does `events/bydate` accept** — integer id or enum?
3. **Which custom field carries eligibility?** Ideally a dedicated Yes/No field
   created for the purpose, so no diagnosis is ever read — see
   [INFOODLE-CSV.md](INFOODLE-CSV.md).
4. **What does `group/memberships/…` return?** Undocumented in the spec.
5. **Does the service account have the permissions** to read every group and
   person that matters, and to write attendance? Test a refusal, not just a 200.
