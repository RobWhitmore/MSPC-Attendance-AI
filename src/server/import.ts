import { generateAccessCode } from "./auth.js";
import {
    asQualifies,
    groupRoleIndex,
    resolvePersonType,
    supportPersonIndex,
    validGroupRole,
} from "./classify.js";
import { DEFAULT_CONCURRENCY, mapLimit } from "./concurrency.js";
import { acceptInfoodleId, rejectionMessage, type InfoodleIdField } from "./external-id.js";
import { listAll, newId, nowIso, upsert, type Doc } from "./repo.js";
import type { ContainerName } from "./cosmos.js";

/**
 * CSV import.
 *
 * This ran in the browser in the Firebase version, writing to Firestore
 * directly and holding every person, group and event in memory to resolve
 * names to ids. It runs here now, which is what made the Cosmos move possible
 * at all - there is no client SDK to point at Cosmos safely.
 */

export const IMPORTABLE = [
    "people",
    "events",
    "rosters",
    "groups",
    "groupTypes",
    "groupMembers",
] as const;

export type ImportableCollection = (typeof IMPORTABLE)[number];

export function isImportable(name: string): name is ImportableCollection {
    return (IMPORTABLE as readonly string[]).includes(name);
}

export interface ImportResult {
    successCount: number;
    mismatchCount: number;
    logs: string[];
}

const str = (v: unknown) => String(v ?? "").trim();
const lower = (v: unknown) => str(v).toLowerCase();

export async function importCollection(
    collectionName: ImportableCollection,
    rows: readonly Doc[],
    actorEmail: string
): Promise<ImportResult> {
    const logs: string[] = [];
    let successCount = 0;
    let mismatchCount = 0;

    // ---- lookup tables, built once ------------------------------------------
    const needsGroups = ["groups", "events", "rosters", "groupMembers"].includes(collectionName);
    const needsPeople = ["groupMembers", "people", "rosters"].includes(collectionName);
    const needsRoles = ["people", "groupMembers"].includes(collectionName);

    const groupsByName = new Map<string, string>();
    if (needsGroups) {
        for (const g of await listAll("groups")) {
            if (g.name) groupsByName.set(lower(g.name), String(g.id));
        }
    }

    const groupTypesByShort = new Map<string, string>();
    if (collectionName === "groups") {
        for (const gt of await listAll("groupTypes")) {
            if (gt.shortValue) groupTypesByShort.set(lower(gt.shortValue), String(gt.id));
        }
    }

    const peopleByName = new Map<string, string>();
    const peopleById = new Map<string, Doc>();
    let existingPeople: Doc[] = [];
    if (needsPeople) {
        existingPeople = await listAll("people");
        for (const p of existingPeople) {
            const fullName = `${str(p.firstName)} ${str(p.lastName)}`.toLowerCase().trim();
            if (!fullName) continue;
            peopleByName.set(fullName, String(p.id));
            peopleById.set(String(p.id), p);
            const email = lower(p.email);
            if (email) peopleByName.set(`${fullName}|${email}`, String(p.id));
        }
    }

    const eventsByTitleDate = new Map<string, string>();
    if (collectionName === "rosters") {
        for (const e of await listAll("events")) {
            const title = lower(e.title);
            const date = str(e.date);
            if (title && date) eventsByTitleDate.set(`${title}|${date}`, String(e.id));
        }
    }

    const roles = needsRoles ? groupRoleIndex(await listAll("groupMembers")) : groupRoleIndex([]);

    // Support-person index includes names named only in this import, so a
    // support person introduced by the same file is recognised.
    const support = supportPersonIndex([
        ...existingPeople,
        ...rows.filter(r => r.supportPersonName).map(r => ({ supportPersonName: r.supportPersonName })),
    ]);

    // Pre-allocate ids for people the import is about to create, so that a row
    // referring to another row's person by name can resolve it.
    if (collectionName === "people") {
        for (const row of rows) {
            const fullName = `${str(row.firstName)} ${str(row.lastName)}`.toLowerCase().trim();
            if (!fullName) continue;
            const email = lower(row.email);
            const key = email ? `${fullName}|${email}` : fullName;
            if (!peopleByName.has(key)) {
                const id = newId();
                peopleByName.set(key, id);
                if (!peopleByName.has(fullName)) peopleByName.set(fullName, id);
            }
        }
    }

    /*
      A `condition` column used to be accepted, read for its meaning and thrown
      away. It is refused now.

      Nothing was ever stored, but the column's existence invited an export that
      put a diagnosis in a CSV sitting in somebody's downloads folder - which is
      the disclosure, whatever the importer then does with it. MS and PD are
      still distinguished, by which condition-specific group somebody belongs
      to; see INFOODLE-CSV.md.

      Refusing loudly rather than ignoring silently: a file with only a
      `condition` column would otherwise mark every person as not qualifying,
      and reclassify the lot as `external`. The value itself is never echoed
      into the message - this log is retained.
    */
    if (collectionName === "people" && rows.some(row => str(row.condition) !== "")) {
        logs.push(
            "This file has a `condition` column, which is no longer accepted. No diagnosis " +
            "was read or stored. Replace it with a `qualifies` column of TRUE/FALSE derived " +
            "in Infoodle - otherwise every row here counts as not qualifying."
        );
        mismatchCount++;
    }

    // ---- pass 1: work out every document, touching nothing ------------------
    // Computation only. Deciding first and writing second keeps two concurrent
    // rows from racing on the same person, which is exactly what would happen
    // if the writes below were interleaved with this logic.
    const pending: { container: ContainerName; item: Doc }[] = [];

    /**
     * Take a supplied external id only when it could actually be one.
     *
     * Infoodle issues integers. Storing anything else puts a value in the field
     * that will fail the moment it reaches the Infoodle API - better to report
     * it at import, where somebody can fix the spreadsheet.
     */
    const takeId = (field: InfoodleIdField, raw: unknown): string | undefined => {
        const { value, rejected } = acceptInfoodleId(raw);
        if (rejected !== undefined) {
            logs.push(`Row ${rowIndex}: ${rejectionMessage(field, rejected)}`);
            mismatchCount++;
        }
        return value;
    };

    let rowIndex = 1;
    for (const row of rows) {
        rowIndex++;
        let docId = newId();
        let docData: Doc | null = null;
        const alsoWrite: { container: ContainerName; item: Doc }[] = [];

        if (collectionName === "people") {
            const first = str(row.firstName);
            const last = str(row.lastName);
            const email = lower(row.email);
            const fullName = `${first} ${last}`.toLowerCase().trim();
            const key = email ? `${fullName}|${email}` : fullName;
            if (fullName && peopleByName.has(key)) docId = peopleByName.get(key)!;

            const existing = peopleById.get(docId);

            const supportName = str(row.supportPersonName);
            const supportId = supportName ? peopleByName.get(supportName.toLowerCase()) ?? null : null;
            if (supportName && !supportId) {
                logs.push(`Row ${rowIndex}: Support Person [${supportName}] not found. Link will be missing.`);
                mismatchCount++;
            }

            // `qualifies` is the only source. A person already carrying the flag
            // keeps it when the column is absent, so a partial import cannot
            // quietly demote everybody it does not mention.
            const qualifies = str(row.qualifies) !== ""
                ? asQualifies(row.qualifies)
                : asQualifies(existing?.qualifies);

            docData = {
                id: docId,
                // Absent when the import does not supply a usable one. See
                // external-id.ts: this names a record in Infoodle, and we
                // neither invent it nor store something that cannot be it.
                //
                // Two fields, because Infoodle issues two different numbers for
                // a person and only the column they arrived in tells them
                // apart. A CSV export gives the unique_id; attendance
                // write-back needs the userId.
                infoodleId: takeId("infoodleId", row.infoodleId) ?? existing?.infoodleId,
                infoodleUniqueId:
                    takeId("infoodleUniqueId", row.infoodleUniqueId) ?? existing?.infoodleUniqueId,
                firstName: first || "Unknown",
                lastName: last || "Unknown",
                email: str(row.email),
                type: resolvePersonType({
                    currentType: row.type,
                    qualifies,
                    isSupportPerson: support.has(docId, first, last),
                    groupRoles: roles.rolesFor(docId),
                }),
                qualifies,
                supportPersonName: supportName || null,
                // An existing person keeps their access code. The Firebase
                // version minted a new one on every import row, which silently
                // killed every magic link already in circulation.
                accessCode: existing?.accessCode ?? generateAccessCode(),
                createdAt: existing?.createdAt ?? nowIso(),
                updatedAt: nowIso(),
            };
            if (supportId) docData.supportPersonId = supportId;
        } else if (collectionName === "events") {
            const groupId = groupsByName.get(lower(row.groupName)) || str(row.groupId);
            if (!groupId) {
                logs.push(`Row ${rowIndex}: Group Name [${str(row.groupName)}] not found in database.`);
                mismatchCount++;
                continue;
            }
            docData = {
                id: docId,
                // Events have one id only - an event is not a person, and
                // Infoodle keys it on id plus occurrence date.
                infoodleId: takeId("infoodleId", row.infoodleId),
                groupId,
                title: str(row.title) || "Unknown Event",
                date: str(row.date),
                time: str(row.time),
                duration: Number(row.duration) || 60,
                status: str(row.status) || "active",
                notes: str(row.notes),
                createdAt: nowIso(),
            };
        } else if (collectionName === "rosters") {
            const personId = peopleByName.get(lower(row.personName)) || str(row.personId);
            const eventId =
                eventsByTitleDate.get(`${lower(row.eventTitle)}|${str(row.eventDate)}`) ||
                str(row.eventId);

            if (!personId) {
                logs.push(`Row ${rowIndex}: Person [${str(row.personName) || str(row.personId)}] not found.`);
                mismatchCount++;
                continue;
            }
            if (!eventId) {
                logs.push(
                    `Row ${rowIndex}: Event [${str(row.eventTitle) || str(row.eventId)} on ${str(row.eventDate)}] not found.`
                );
                mismatchCount++;
                continue;
            }

            const rsvp = lower(row.rsvpStatus);
            // Legacy exports say "absent"; the app's vocabulary is "no-show".
            const attendanceRaw = lower(row.attendanceStatus) === "absent" ? "no-show" : lower(row.attendanceStatus);

            docData = {
                id: docId,
                eventId,
                personId,
                role: validGroupRole(row.role),
                rsvpStatus: ["potential", "booked", "cancelled"].includes(rsvp) ? rsvp : "potential",
                attendanceStatus: ["present", "no-show", "unknown"].includes(attendanceRaw)
                    ? attendanceRaw
                    : "unknown",
                createdAt: nowIso(),
                updatedAt: nowIso(),
            };
        } else if (collectionName === "groups") {
            const groupTypeId = groupTypesByShort.get(lower(row.shortValue)) || str(row.groupTypeId);
            if (!groupTypeId) {
                logs.push(`Row ${rowIndex}: Group Type [${str(row.shortValue) || str(row.groupTypeId)}] not found.`);
                mismatchCount++;
                continue;
            }
            docData = {
                id: docId,
                groupTypeId,
                name: str(row.name) || "Unknown Group",
                dateRule: str(row.dateRule),
                timeRule: str(row.timeRule),
                scheduleText: str(row.scheduleText),
                skipHolidays: row.skipHolidays === "true" || row.skipHolidays === true,
                who: str(row.who),
                locationName: str(row.locationName),
                locationLink: str(row.locationLink),
                createdAt: nowIso(),
            };
        } else if (collectionName === "groupTypes") {
            docData = {
                id: docId,
                shortValue: str(row.shortValue) || "Unknown",
                longValue: str(row.longValue) || "Unknown",
                createdAt: nowIso(),
            };
        } else if (collectionName === "groupMembers") {
            const role = validGroupRole(row.role);
            const groupId = groupsByName.get(lower(row.groupName)) || str(row.groupId);
            const personId = peopleByName.get(lower(row.fullName)) || str(row.personId);

            if (!groupId) {
                logs.push(`Row ${rowIndex}: Group [${str(row.groupName) || str(row.groupId)}] not found.`);
                mismatchCount++;
                continue;
            }
            if (!personId) {
                logs.push(`Row ${rowIndex}: Person [${str(row.fullName) || str(row.personId)}] not found.`);
                mismatchCount++;
                continue;
            }

            docData = { id: docId, groupId, personId, role, createdAt: nowIso() };

            // Adding somebody to a group can change what they are.
            const person = peopleById.get(personId);
            if (person) {
                const qualifies = asQualifies(person.qualifies);
                const resolved = resolvePersonType({
                    currentType: person.type,
                    qualifies,
                    isSupportPerson: support.has(personId, person.firstName, person.lastName),
                    groupRoles: [...roles.rolesFor(personId), role],
                });
                if (resolved !== lower(person.type)) {
                    person.type = resolved;
                    alsoWrite.push({
                        container: "people",
                        item: { ...person, type: resolved, updatedAt: nowIso() },
                    });
                }
            }
        }

        if (!docData) continue;

        pending.push({ container: collectionName, item: docData });
        pending.push(...alsoWrite);
        successCount++;
    }

    // ---- pass 2: write, several at a time -----------------------------------
    // Sequentially this paid a full round trip per row and ran out of the
    // platform's 45-second request budget somewhere around 2,000 rows. The
    // limit now is the free tier's 1,000 RU/s, which is a much higher one.
    //
    // Later entries win, so a file naming the same person twice behaves as it
    // did when the writes were sequential.
    await mapLimit(dedupeByTarget(pending), DEFAULT_CONCURRENCY, entry =>
        upsert(entry.container, entry.item)
    );

    // ---- one audit record for the import, not one per row -------------------
    await upsert("auditLogs", {
        id: newId(),
        action: "import",
        collectionId: collectionName,
        rowCount: rows.length,
        successCount,
        mismatchCount,
        // The messages name people, which is ordinary for this app. They never
        // carry an access code or a diagnosis, and the imported rows themselves
        // are deliberately not stored - a retained log is the last place a
        // credential or a medical detail should end up.
        logs: logs.slice(0, 200),
        userId: actorEmail,
        timestamp: nowIso(),
    });

    return { successCount, mismatchCount, logs };
}

/**
 * Collapse repeated writes to the same document, keeping the last.
 *
 * Two rows can target one person - a group import that reclassifies somebody
 * mentioned twice, for instance. Sequential writes resolved that naturally by
 * overwriting; concurrent ones would race, so it is resolved here instead.
 */
function dedupeByTarget(
    entries: readonly { container: ContainerName; item: Doc }[]
): { container: ContainerName; item: Doc }[] {
    const byKey = new Map<string, { container: ContainerName; item: Doc }>();
    for (const entry of entries) {
        byKey.set(`${entry.container}:${entry.item.id}`, entry);
    }
    return [...byKey.values()];
}
