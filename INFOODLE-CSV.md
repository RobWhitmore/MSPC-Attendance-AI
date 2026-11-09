# Loading from Infoodle by CSV, before API access exists

API access will take time. The app's CSV importer already does everything the
initial load needs — it resolves names to ids, classifies people, and preserves
access codes — so exporting queries from Infoodle and importing them here gets
the system working now, and the API becomes an upgrade rather than a
prerequisite.

This document specifies the exact queries, column by column. Read
[INFOODLE-API.md](INFOODLE-API.md) for the eventual API path and
[DEPLOY.md §6](DEPLOY.md) for where this sits in the deployment.

---

## The rule that governs every query

> **A CSV must contain nothing the database would not store.**

That is the whole test, and it is checkable. The app's schema is already the
result of deciding what is worth holding: it keeps `qualifies: true/false` and
never the diagnosis, it keeps a name and an email and no address, no date of
birth, no phone number, no giving history.

An export that goes wider than the schema is not "extra data available for
later" — it is a file of confidential information sitting in a Downloads folder,
attached to an email, or forwarded to whoever is helping with the import. The
importer would silently ignore the extra columns; the exposure happens before it
ever reaches the importer.

So the column lists below are exhaustive. **Do not add columns because Infoodle
offers them.**

### Never export

| Field | Why |
| --- | --- |
| Condition / diagnosis / health notes | The reason the schema changed. See below |
| Date of birth | Not stored, not needed |
| Home address | Not stored |
| Phone numbers | Not stored |
| Giving, pledges, transactions | Not stored, and the most sensitive data Infoodle holds |
| Pastoral or safeguarding notes | Not stored |
| Photos (`person_image`) | Not stored, and bloats the file enormously |
| Emergency contacts, household detail | Not stored |

**A `condition` column is refused.** The importer used to accept one, read the
text for its meaning and throw the wording away. Nothing was ever stored, but a
supported column is an invitation to export one — and the disclosure is the
diagnosis sitting in a CSV in somebody's downloads folder, whatever the importer
subsequently does with it.

It now stops the import with a warning
([import.ts:139](src/server/import.ts#L139)), and nothing anywhere in the
codebase interprets diagnosis wording. `classify.ts` has no `qualifiesFromText`
and [classify.test.ts](test/classify.test.ts) fails if one reappears.

Note that it is **refused, not ignored**. Ignoring it would leave every row
without a `qualifies` value, marking the lot as not qualifying and reclassifying
them as `external` — a silent, wrong, and entirely plausible-looking result. The
warning names the offending column and its replacement, and never quotes the
value, because the audit record is retained.

---

## Getting `qualifies` without exporting a diagnosis

In every approach below the principle is the same: **the diagnosis belongs in
the filter, not in the output.** A filter runs inside Infoodle and never leaves
it; the export carries only the answer.

### Distinguishing MS from PD — already solved, by groups

MSPC needs to tell people with MS from people with PD, to allocate them to
condition-related groups. **No person field is needed for this, and none should
be added.** The distinction is already in the schema, one level up:

```
groupTypes.shortValue   "MS" / "PD"
   ^
groups.groupTypeId       "Parkinson's - Rangiora Support Group"
   ^
groupMembers             personId + groupId + role
```

`groupTypes.shortValue` is `MS` or `PD` and always has been
([requirements.md §3.6](requirements.md)). Allocating someone to the Rangiora
Parkinson's group records which condition they are being served for, because
that is what the allocation *is*.

The `condition` field on a person was a **second copy** of the same fact — and
the copy with no operational use, since the only thing the code ever asked it
was the yes/no question `qualifies` now answers. Removing it lost nothing.

So for the CSV load:

- `people.csv` carries `qualifies` — a boolean, no condition.
- `groupMembers.csv` carries the allocation, which is where MS and PD live.
- Someone whose condition is known but who has not been allocated to a group
  yet is simply `qualifies: TRUE` and in no group. Do the allocation in
  Infoodle, where the condition already is, and export the result.

**The allocation must happen in Infoodle**, not in this app. An admin here sees
`qualifies` and group membership, never a diagnosis, so there is nothing in the
app to allocate an unallocated person *from*. If MSPC would rather allocate in
this app, that needs a diagnosis field, which is a different decision with a
consequence attached — see the region note below.

### Be honest about what this means

Group membership under an `MS` or `PD` group type **is health information about
an identifiable person**, by inference. Calling it "group membership" does not
change what it discloses.

That is not an argument against this approach — it is the right approach, and
the inference is unavoidable in a system whose entire purpose is running
attendance for condition-specific groups. It does mean the database holds
health-inferable data whichever route is taken, so a claim that it holds none is
wrong, and I have corrected it in [DEPLOY.md](DEPLOY.md),
[ARCHITECTURE.md](ARCHITECTURE.md), [HANDOVER.md](HANDOVER.md) and
[PROVISION.md](PROVISION.md).

⚠️ **This reopens the Cosmos region choice, and it has to be settled before the
first deployment** — `cosmosLocation` cannot be changed without rebuilding the
account. See [DEPLOY.md §2](DEPLOY.md).

### First, derive `qualifies` — not `type`

It is tempting to compute the person's *type* in Infoodle. Don't: the server
recomputes it on import ([classify.ts:62](src/server/classify.ts#L62)) from
`qualifies`, whether anyone names them as a support person, and what group roles
they hold — none of which Infoodle knows in full. A `type` column arriving from
a query is mostly discarded.

The only value worth deriving is the boolean `qualifies`. Set `type` by hand for
staff and admins, and let everyone else resolve.

### Option A — a Yes/No custom field in Infoodle (recommended)

Rather than deriving the value per export, derive it **once** and store it in
Infoodle as its own field. Infoodle supports a Yes/No custom field type
(`field_type: '2'` in the API, "Yes/No" in the field editor), and custom fields
can be marked as available in search filters.

1. Create a person custom field, something like **"Attendance app — qualifies"**,
   type **Yes/No**.
2. Filter people to those whose condition is one of the qualifying values.
3. Bulk-set the new field to Yes across that result set.
4. Set it to No for everyone else — or leave it blank, since the importer treats
   blank as false.
5. From then on, every people query outputs that field and never touches the
   condition.

This is the best answer for four reasons:

- **The derivation happens once**, inside Infoodle, by someone with a clinical
  reason to see the condition. It is not repeated by whoever runs the next
  export.
- **Every future export is safe by construction.** There is no per-export step
  to remember, and no filter to get subtly wrong.
- **It survives the move to the API.** `qualifies` has no native Infoodle field
  — [INFOODLE-API.md](INFOODLE-API.md) notes it will have to come from
  `person_custom_fields`. Creating it now means the CSV route and the API route
  read the same field, and the eventual switch changes only the transport.
- **It is auditable.** "Which people are flagged as qualifying" becomes a
  question with an answer in Infoodle, rather than an artefact of a query
  someone ran in March.

The cost is step 3: it depends on Infoodle offering a bulk field update over a
search result. If it does not, and the qualifying set is a few hundred people,
ticking a box each is finite but tedious — use Option B instead and revisit this
when API access arrives, at which point the field can be populated
programmatically.

### Option B — two queries, merged (needs nothing new)

Works today, with no configuration change.

**Query P1 — qualifying people**

- Start from: People
- Filter: the condition field **is one of** the qualifying values (MS, multiple
  sclerosis, PD, Parkinson's — whatever MSPC actually uses)
- Output fields: **first name, last name** only
- After export: add a column `qualifies`, fill every row with `TRUE`

**Query P2 — everyone else**

- Start from: People
- Filter: the inverse — condition is empty, or not one of those values
- Output fields: **first name, last name** only
- After export: add a column `qualifies`, fill every row with `FALSE`

Then **combine P1 and P2 into a single `people.csv` and delete the two
intermediates.** That last step matters: on its own, file P1 is a list of named
people who have a qualifying neurological condition. It does not say which one,
which is a real improvement, but it is still health information about
identifiable individuals. Merged into one file with a boolean column, it carries
exactly what the database carries and no more — the standard set above.

Handle both intermediates on a managed device, and do not email them.

### On computed columns in the query builder

Whether Infoodle's query builder can emit a **derived** column — an
if-this-then-`TRUE` expression evaluated at export time — is not something the
API specification covers, because the query builder is a UI feature and the spec
documents only the REST surface. It may well be possible.

If it is, it is equivalent in safety to Option B and saves the merge step, so
use it. But it is worth checking before planning around it, and it is still
weaker than Option A on the three points above: the logic lives in a saved query
rather than in the data, it has to be right in every query that is ever written,
and it does not carry over to the API path.

**Worth asking Infoodle support directly**, alongside the API access request:

> Can a query output a derived Yes/No column computed from a custom field's
> value — for example "TRUE when condition is one of X, Y, Z" — so that the
> underlying value is never included in the exported CSV? And can a Yes/No
> custom field be bulk-set across the results of a search?

The second question is the one that matters more; a Yes on it makes Option A
straightforward.

---

## Load in this order

The importer resolves names to ids against **what is already in the database**,
so each file depends on the ones before it. Out of order, rows are rejected with
"not found" rather than silently mislinked — but that is still a wasted pass.

```
1. groupTypes    no dependencies
2. groups        needs groupTypes   (matched on shortValue)
3. people        no dependencies
4. groupMembers  needs groups + people
5. events        needs groups       (matched on groupName)
6. rosters       needs people + events
```

Two notes on that order:

- **`people` before `groupMembers`, but types settle afterwards.** A person's
  type depends partly on whether they hold a leader or speaker role, which is
  not known until step 4. The groupMembers import re-classifies affected people
  as it goes ([import.ts:307](src/server/import.ts#L307)), so this resolves
  itself — no second people import needed.
- **A support person named in `people.csv` can be another row in the same
  file.** Ids are pre-allocated before the rows are processed, so the two do not
  need separating.

### Get the pipeline working before any personal data moves

Steps 1, 2 and 5 — `groupTypes`, `groups`, `events` — contain **no personal data
at all**. Load those three first, on their own. If they import cleanly you have
proved the whole path end to end: export, header names, upload, resolution,
Cosmos writes, the audit record. Only then move names.

---

## The files

Column names must match **exactly**, including capitalisation. The client parses
with `header: true` and no header transformation, so `First Name`,
`firstname` and `firstName ` (trailing space) are three different columns, none
of which is `firstName`. Infoodle's own export headers will not match — renaming
the header row is a required step for every file.

Save as UTF-8. Unlisted columns are ignored.

### 1. `groupTypes.csv`

| Column | Required | Notes |
| --- | --- | --- |
| `shortValue` | yes | The join key `groups.csv` matches on. Defaults to `Unknown` if blank |
| `longValue` | yes | Display name. Defaults to `Unknown` if blank |

Likely a handful of rows. Faster to type by hand than to export.

```csv
shortValue,longValue
PROG,Programme Groups
SUPP,Support Groups
```

### 2. `groups.csv` — no personal data

| Column | Required | Notes |
| --- | --- | --- |
| `shortValue` | yes* | Must match a `groupTypes.shortValue`, case-insensitive. Row is rejected if not found |
| `groupTypeId` | — | Alternative to `shortValue` if you already know the id |
| `name` | yes | **The join key for `events.csv` and `groupMembers.csv`** — must match those files exactly |
| `dateRule` | no | e.g. `2nd Tuesday` |
| `timeRule` | no | |
| `scheduleText` | no | Free text shown to members |
| `skipHolidays` | no | Literally `true` or `false`; anything else is false |
| `who` | no | Who the group is for |
| `locationName` | no | |
| `locationLink` | no | Map link |

Infoodle supplies `name` and the group type. The schedule and location fields
have no Infoodle equivalent — fill them in by hand or leave blank.

⚠️ `name` is matched case-insensitively but otherwise literally. A group called
`Tuesday Group ` in one file and `Tuesday Group` in another will not join.

### 3. `people.csv`

| Column | Required | Notes |
| --- | --- | --- |
| `firstName` | yes | Defaults to `Unknown` if blank |
| `lastName` | yes | Defaults to `Unknown` if blank |
| `qualifies` | yes | `TRUE` / `FALSE`. Also accepts `yes`, `1`, `qualifying`. **Anything else, including blank, is false.** Source it from the Yes/No custom field, never from the condition |
| `email` | see below | |
| `type` | no | `member`, `staff`, `admin`, `support`, `external`. Often overridden — see below |
| `supportPersonName` | no | `First Last`, matched against another person. Logged as a mismatch if not found |
| `infoodleUniqueId` | recommended | Infoodle's profile `unique_id` — what an export gives you. Integers only |
| `infoodleId` | **omit** | Reserved for the internal `userId`, which a CSV export does not carry. See below |
| ~~`condition`~~ | **never** | |

**On `email`.** It is the only thing separating two people with the same name:
the importer matches on `firstName lastName|email`, falling back to name alone.
Two different Jane Smiths with no email addresses become one person. It is also
how magic links eventually reach people. So:

- **If MSPC has no duplicate names**, leave `email` out of the first load. Names
  alone are enough to build and test everything, and it is the smaller
  disclosure.
- **Add `email` when you need links to reach real people**, or as soon as a
  duplicate name appears. Re-importing with the column added updates the
  existing records rather than duplicating them, *provided the names are
  unchanged*.

**On `type`.** Setting it rarely does what you expect —
[classify.ts:62](src/server/classify.ts#L62) recomputes it. A person marked
`member` without `qualifies` becomes `external`; anyone named as a support
person becomes `support`. Set it only for `staff` and `admin`, and let the rest
resolve.

**On the two id columns.** Infoodle issues two different numbers for a person,
and they are not interchangeable (see [INFOODLE-API.md](INFOODLE-API.md)):

| Column | Holds | Where it comes from |
| --- | --- | --- |
| `infoodleUniqueId` | profile `unique_id` | `people/search`, and every CSV export |
| `infoodleId` | internal `userId` | `groups/members` — **what attendance write-back needs** |

Both are integers, so no validator can tell them apart — **the column they
arrive in is the only distinction**, which is why they are stored in separate
fields. Putting a `unique_id` into `infoodleId` would store a value that passes
every check and then posts attendance against whoever holds that number as a
`userId`.

So: **put the export's id in `infoodleUniqueId`, and leave `infoodleId`
empty.** It gets filled in later, from `groups/members`, when API access
arrives. Keeping the `unique_id` now is worth doing — it makes that eventual
matching pass a lookup rather than a name-matching exercise.

A non-integer in either column is refused with a message naming the column, and
the field is left blank rather than filled with something wrong.

### 4. `groupMembers.csv` — names, no contact details

| Column | Required | Notes |
| --- | --- | --- |
| `groupName` | yes* | Must match a `groups.name` already loaded |
| `groupId` | — | Alternative to `groupName` |
| `fullName` | yes* | `First Last`, matched against loaded people |
| `personId` | — | Alternative to `fullName` |
| `role` | no | `member`, `leader`, `speaker`, `staff`, `support`. **Anything else silently becomes `member`** |

One row per person per group. In Infoodle this is a per-group member export,
run once for each group, outputting **name only** — no email, no phone, no
address.

⚠️ Infoodle's membership levels are `A` / `F` / `V` / `P`, which are not our role
names. Map them on the way out: `A` → `leader`, `F` and `V` → `member`, and
**drop `P` (past member) rows entirely** rather than importing them as members.
An unmapped `A` arriving as `A` becomes `member`, quietly demoting every group
leader — and because leadership feeds the type rules, that also mis-types them.

### 5. `events.csv` — no personal data

| Column | Required | Notes |
| --- | --- | --- |
| `groupName` | yes* | Must match a `groups.name`. Row is rejected if not found |
| `groupId` | — | Alternative to `groupName` |
| `title` | yes | **Join key for `rosters.csv`**, with `date`. Defaults to `Unknown Event` |
| `date` | yes | Also a join key. Use one format throughout — `YYYY-MM-DD` |
| `time` | no | |
| `duration` | no | Minutes. Defaults to `60` |
| `status` | no | Defaults to `active` |
| `notes` | no | **Keep blank.** Free-text notes are where personal detail leaks in |
| `infoodleId` | **omit** | Same reasoning as people |

⚠️ Infoodle identifies a repeating event by **id plus occurrence date** — one id
covers every occurrence. Export one row per occurrence, not one per event
series, or the roster join will collapse every date onto one event.

### 6. `rosters.csv`

| Column | Required | Notes |
| --- | --- | --- |
| `personName` | yes* | `First Last`, matched against loaded people |
| `personId` | — | Alternative to `personName` |
| `eventTitle` | yes* | With `eventDate`, must match a loaded event exactly |
| `eventDate` | yes* | Same format as `events.date` |
| `eventId` | — | Alternative to the title/date pair |
| `role` | no | Same values as `groupMembers.role` |
| `rsvpStatus` | no | `potential`, `booked`, `cancelled`. Anything else becomes `potential` |
| `attendanceStatus` | no | `present`, `no-show`, `unknown`. `absent` is translated to `no-show`. Anything else becomes `unknown` |

Infoodle's attendance status is numeric: `1` checked in, `0` checked out, `-1`
not checked in or out. Map to `present`, `no-show` and `unknown` respectively —
though note `0` genuinely means "checked out", not "did not attend", so if MSPC
uses check-out at all, `no-show` is the wrong translation and those rows are
better left `unknown`.

This is the largest file and the least valuable to backfill. Historic attendance
is nice to have; consider loading only the current term and letting the app
accumulate the rest.

---

## Re-importing

The CSV route is not a one-shot. Re-importing the same file updates rather than
duplicates, **as long as the matching key is stable** — `firstName lastName` plus
`email` where present. Two consequences worth knowing before the first load:

- **Access codes survive.** An existing person keeps theirs
  ([import.ts:203](src/server/import.ts#L203)). The Firebase version minted a new
  code on every import row, which killed every magic link in circulation. If a
  person's name changes in Infoodle, though, they import as a *new* person with a
  *new* code, and their old link keeps working against an orphaned record.
- **Nothing is deleted.** Removing someone from Infoodle does not remove them
  here. Use the maintenance tab for that, deliberately.

Each import writes one audit record naming the actor, the row count, and up to
200 mismatch messages. Those messages name people — ordinary for this app — but
never a code or a diagnosis.

---

## What CSV cannot do

Worth knowing so nothing waits on it:

- **No write-back.** Attendance recorded in the app stays in the app until the
  API exists. If MSPC needs attendance in Infoodle meanwhile, that is a manual
  re-entry, and it is the strongest argument for chasing API access.
- **No deltas.** `people/poll_new` has no CSV equivalent, so every refresh is a
  full re-export and re-import. Fine weekly; unpleasant daily.
- **No `userId`.** A CSV export carries the profile `unique_id`, which imports
  into `infoodleUniqueId`. `infoodleId` — the number attendance write-back
  needs — stays empty until the API can supply it from `groups/members`. That
  pass is a lookup on the stored `unique_id` rather than a name match, which is
  precisely why the column is worth exporting now.

None of these block getting the system working, which is what this route is for.
