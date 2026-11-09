import { Router, type Request, type Response, type NextFunction } from "express";
import { generateGroupEventsFromSchedule } from "../../lib/dateUtils.js";
import {
    adminEmailDomains,
    generateAccessCode,
    getPrincipal,
    publicPeople,
    serverError,
    verifyAdmin,
    type Principal,
} from "../auth.js";
import {
    asQualifies,
    groupRoleIndex,
    resolvePersonType,
    supportPersonIndex,
    validGroupRole,
} from "../classify.js";
import { DEFAULT_CONCURRENCY, mapLimit } from "../concurrency.js";
import { acceptInfoodleId, INFOODLE_ID_FIELDS } from "../external-id.js";
import { importCollection, isImportable } from "../import.js";
import {
    byField,
    byFields,
    findById,
    getById,
    listAll,
    newId,
    nowIso,
    remove,
    removeMany,
    upsert,
    type Doc,
} from "../repo.js";
import { CONTAINER_NAMES, type ContainerName } from "../cosmos.js";

const router = Router();

/** Collections the admin UI is allowed to name in a URL. */
const MANAGED: ContainerName[] = [
    "people",
    "events",
    "groups",
    "groupTypes",
    "rosters",
    "groupMembers",
];

/** Deleting a collection wholesale takes its dependents with it. */
const DEPENDENTS: Partial<Record<ContainerName, ContainerName[]>> = {
    groupTypes: ["groups", "events", "rosters", "groupMembers"],
    groups: ["events", "rosters", "groupMembers"],
    events: ["rosters"],
    people: ["rosters", "groupMembers"],
};

/** What a system backup covers. `auditLogs` is append-only noise and is excluded. */
const BACKUP_COLLECTIONS: ContainerName[] = [
    "people",
    "events",
    "groups",
    "groupTypes",
    "rosters",
    "groupMembers",
    "admins",
];

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            principal?: Principal;
        }
    }
}

/**
 * Every route below this line requires an admin. One gate, applied by the
 * router, rather than a `verifyAdmin` call each handler could forget.
 */
router.use(async (req: Request, res: Response, next: NextFunction) => {
    // /me answers "who am I, and am I an admin?" and must not 403.
    if (req.path === "/me") return next();
    try {
        const principal = await verifyAdmin(req);
        if (!principal) return res.status(403).json({ error: "Forbidden" });
        req.principal = principal;
        next();
    } catch (err) {
        serverError(res, "admin/authorise", err);
    }
});

/**
 * Who the caller is. The client uses this to decide between the app, a
 * sign-in prompt, and "signed in but not an admin" - three states that a bare
 * 401 cannot tell apart.
 */
router.get("/me", async (req, res) => {
    try {
        const principal = getPrincipal(req);
        if (!principal) {
            return res.json({ signedIn: false, isAdmin: false, reason: "no-principal" });
        }
        if (!principal.email) {
            return res.json({ signedIn: true, isAdmin: false, reason: "no-email-claim" });
        }

        const domains = adminEmailDomains();
        const domain = principal.email.split("@")[1] || "";
        if (!domains.includes(domain)) {
            return res.json({
                signedIn: true,
                isAdmin: false,
                email: principal.email,
                reason: "domain-not-allowed",
            });
        }

        const record = await getById("admins", principal.email);
        if (!record) {
            return res.json({
                signedIn: true,
                isAdmin: false,
                email: principal.email,
                reason: "no-admin-record",
            });
        }

        res.json({ signedIn: true, isAdmin: true, email: principal.email, role: record.role ?? "admin" });
    } catch (err) {
        serverError(res, "admin/me", err);
    }
});

/**
 * Bulk read for a tab. Replaces the six parallel `getDocs` calls each tab used
 * to make straight from the browser.
 */
router.get("/data/:tab", async (req, res) => {
    try {
        const tab = String(req.params.tab);
        const wanted: Record<string, ContainerName[]> = {
            Dashboard: ["events", "groups", "rosters", "people", "groupMembers", "groupTypes"],
            People: ["people", "groupMembers", "rosters", "events"],
            Groups: ["groups", "groupTypes", "groupMembers", "events", "rosters", "people"],
            Events: ["events", "groups", "groupTypes", "rosters"],
            Maintenance: ["people", "events", "groups", "groupTypes", "rosters", "groupMembers"],
        };

        const collections = wanted[tab];
        if (!collections) return res.json({});

        const loaded = await Promise.all(collections.map(c => listAll(c)));
        const payload: Record<string, Doc[]> = {};
        collections.forEach((name, i) => {
            // An admin manages people but still has no business receiving a
            // credential they never need to see.
            payload[name] = name === "people" ? publicPeople(loaded[i]) : loaded[i];
        });

        res.json(payload);
    } catch (err) {
        serverError(res, "admin/data", err);
    }
});

// ---------------------------------------------------------------------------
// Rosters and events
// ---------------------------------------------------------------------------

router.post("/action", async (req, res) => {
    try {
        const { eventId, targetPersonId, action, value } = req.body ?? {};
        if (!eventId || !targetPersonId || !action) {
            return res.status(400).json({ error: "Missing fields" });
        }

        const event = await findById("events", String(eventId));
        if (!event) return res.status(404).json({ error: "Event not found" });

        const existing = (await byFields("rosters", {
            eventId: String(eventId),
            personId: String(targetPersonId),
        }))[0];

        const updates: Doc = existing
            ? { ...existing, updatedAt: nowIso() }
            : {
                  id: newId(),
                  eventId: String(eventId),
                  personId: String(targetPersonId),
                  rsvpStatus: "potential",
                  attendanceStatus: "unknown",
                  role: "member",
                  createdAt: nowIso(),
                  updatedAt: nowIso(),
              };

        if (action === "rsvp") {
            const currentRsvp = String(existing?.rsvpStatus || "potential");
            const currentAttendance = String(existing?.attendanceStatus || "unknown");
            updates.rsvpStatus = value;
            if (currentRsvp === "booked" && currentAttendance === "no-show" && value !== "booked") {
                updates.attendanceStatus = "unknown";
            }
        }
        if (action === "attendance") updates.attendanceStatus = value;
        if (action === "note") updates.note = value;

        await upsert("rosters", updates);
        res.json({ success: true });
    } catch (err) {
        serverError(res, "admin/action", err);
    }
});

router.post("/submit-attendance", async (req, res) => {
    try {
        const { eventId } = req.body ?? {};
        if (!eventId) return res.status(400).json({ error: "Missing fields" });

        const event = await findById("events", String(eventId));
        if (!event) return res.status(404).json({ error: "Event not found" });

        await upsert("events", {
            ...event,
            rosterStatus: "submitted",
            status: "submitted",
            updatedAt: nowIso(),
        });
        res.json({ success: true });
    } catch (err) {
        serverError(res, "admin/submit-attendance", err);
    }
});

router.post("/export-event", async (req, res) => {
    try {
        const { eventId } = req.body ?? {};
        if (!eventId) return res.status(400).json({ error: "Missing fields" });

        const event = await findById("events", String(eventId));
        if (!event) return res.status(404).json({ error: "Event not found" });

        await upsert("events", { ...event, status: "exported", updatedAt: nowIso() });
        res.json({ success: true });
    } catch (err) {
        serverError(res, "admin/export-event", err);
    }
});

/** Create events from each group's schedule rule, for the next 35 days. */
router.post("/generate-events", async (_req, res) => {
    try {
        const groups = await listAll("groups");
        const existing = await listAll("events");

        const seen = new Set(
            existing
                .filter(e => e.groupId && e.date && e.time)
                .map(e => `${e.groupId}_${e.date}_${e.time}`)
        );

        const from = new Date();
        from.setHours(0, 0, 0, 0);

        let createdCount = 0;
        for (const group of groups) {
            for (const occ of generateGroupEventsFromSchedule(group as any, from, 35)) {
                const key = `${group.id}_${occ.date}_${occ.time}`;
                if (seen.has(key)) continue;
                seen.add(key);

                await upsert("events", {
                    id: newId(),
                    // No infoodleId: this event was generated here from a group
                    // schedule and does not exist in Infoodle. Inventing one
                    // would make a local event indistinguishable from a synced
                    // one. See external-id.ts.
                    groupId: String(group.id),
                    title: group.name || "Scheduled Event",
                    date: occ.date,
                    time: occ.time,
                    duration: occ.duration,
                    status: "active",
                    notes: "Auto-generated from group schedule",
                    createdAt: nowIso(),
                });
                createdCount++;
            }
        }

        res.json({ success: true, createdCount });
    } catch (err) {
        serverError(res, "admin/generate-events", err);
    }
});

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/**
 * Fields an admin may set on a person.
 *
 * `accessCode` is deliberately absent - it is a credential, issued server-side.
 * `condition` is absent because the diagnosis is not stored at all; `qualifies`
 * records only whether one exists.
 */
const EDITABLE_PERSON_FIELDS = [
    "firstName",
    "lastName",
    "email",
    "phone",
    "type",
    "qualifies",
    "supportPersonId",
    "supportPersonName",
    "infoodleId",
    "infoodleUniqueId",
];

router.patch("/people/:id", async (req, res) => {
    try {
        const person = await getById("people", String(req.params.id));
        if (!person) return res.status(404).json({ error: "Person not found" });

        const updates: Doc = {};
        for (const field of EDITABLE_PERSON_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(req.body ?? {}, field)) {
                updates[field] = field === "qualifies"
                    ? asQualifies(req.body[field])
                    : req.body[field];
            }
        }

        const saved = await upsert("people", { ...person, ...updates, updatedAt: nowIso() });
        res.json({ success: true, person: publicPeople([saved])[0] });
    } catch (err) {
        serverError(res, "admin/people/patch", err);
    }
});

/** Delete a person and everything that points at them. */
router.delete("/people/:id", async (req, res) => {
    try {
        const personId = String(req.params.id);
        const person = await getById("people", personId);
        if (!person) return res.status(404).json({ error: "Person not found" });

        const memberships = await byField("groupMembers", "personId", personId);
        const rosters = await byField("rosters", "personId", personId);

        await removeMany("groupMembers", memberships);
        await removeMany("rosters", rosters);
        await remove("people", personId);

        res.json({
            success: true,
            deleted: { groupMembers: memberships.length, rosters: rosters.length },
        });
    } catch (err) {
        serverError(res, "admin/people/delete", err);
    }
});

/** Accept a pending new member or support person. */
router.post("/people/:id/approve", async (req, res) => {
    try {
        const person = await getById("people", String(req.params.id));
        if (!person) return res.status(404).json({ error: "Person not found" });

        const currentType = String(person.type || "").toLowerCase();
        const approved =
            currentType === "new_support" ? "support" : currentType === "new_member" ? "member" : null;
        if (!approved) {
            return res.status(400).json({ error: `Person is not pending approval (type: ${currentType})` });
        }

        await upsert("people", { ...person, type: approved, updatedAt: nowIso() });
        res.json({ success: true, type: approved });
    } catch (err) {
        serverError(res, "admin/people/approve", err);
    }
});

/**
 * Re-derive a person's type from the classification rules.
 *
 * The browser used to hold every person and every membership in order to do
 * this. Here the rules read what they need directly.
 */
router.post("/people/:id/reclassify", async (req, res) => {
    try {
        const personId = String(req.params.id);
        const person = await getById("people", personId);
        if (!person) return res.status(404).json({ error: "Person not found" });

        const [people, groupMembers] = await Promise.all([
            listAll("people"),
            listAll("groupMembers"),
        ]);

        const support = supportPersonIndex(people);
        const roles = groupRoleIndex(groupMembers);
        const extraRole = req.body?.newGroupMemberRole
            ? [validGroupRole(req.body.newGroupMemberRole)]
            : [];

        const qualifies = asQualifies(person.qualifies);
        const resolved = resolvePersonType({
            currentType: person.type,
            qualifies,
            isSupportPerson: support.has(personId, person.firstName, person.lastName),
            groupRoles: [...roles.rolesFor(personId), ...extraRole],
        });

        const changed = resolved !== String(person.type || "").toLowerCase();
        if (changed) {
            await upsert("people", { ...person, type: resolved, updatedAt: nowIso() });
        }

        res.json({ success: true, changed, type: resolved, qualifies });
    } catch (err) {
        serverError(res, "admin/people/reclassify", err);
    }
});

// ---------------------------------------------------------------------------
// Group membership
// ---------------------------------------------------------------------------

router.post("/group-members", async (req, res) => {
    try {
        const { personId, groupId, role } = req.body ?? {};
        if (!personId || !groupId) {
            return res.status(400).json({ error: "Missing personId or groupId" });
        }

        const existing = await byFields("groupMembers", {
            personId: String(personId),
            groupId: String(groupId),
        });
        if (existing.length > 0) {
            return res.status(409).json({ error: "Already a member of this group", groupMember: existing[0] });
        }

        const groupMember = await upsert("groupMembers", {
            id: newId(),
            personId: String(personId),
            groupId: String(groupId),
            role: validGroupRole(role),
            createdAt: nowIso(),
            updatedAt: nowIso(),
        });

        res.json({ success: true, groupMember });
    } catch (err) {
        serverError(res, "admin/group-members/create", err);
    }
});

router.patch("/group-members/:id", async (req, res) => {
    try {
        const found = await findById("groupMembers", String(req.params.id));
        if (!found) return res.status(404).json({ error: "Group member not found" });

        const groupMember = await upsert("groupMembers", {
            ...found,
            role: validGroupRole(req.body?.role),
            updatedAt: nowIso(),
        });
        res.json({ success: true, groupMember });
    } catch (err) {
        serverError(res, "admin/group-members/patch", err);
    }
});

router.delete("/group-members/:id", async (req, res) => {
    try {
        const found = await findById("groupMembers", String(req.params.id));
        if (!found) return res.status(404).json({ error: "Group member not found" });

        await remove("groupMembers", String(found.id), String(found.groupId));
        res.json({ success: true });
    } catch (err) {
        serverError(res, "admin/group-members/delete", err);
    }
});

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

/**
 * What a wholesale delete would remove, without removing it. The client shows
 * these counts in its confirmation dialog, so the dialog states facts read from
 * the database rather than guesses made in the browser.
 */
router.get("/collections/:name/delete-all-preview", async (req, res) => {
    try {
        const name = assertManaged(req.params.name);
        if (!name) return res.status(400).json({ error: "Unknown collection" });

        const primary = await listAll(name);
        const dependents: Record<string, number> = {};
        for (const dep of DEPENDENTS[name] ?? []) {
            dependents[dep] = (await listAll(dep)).length;
        }

        res.json({ collection: name, count: primary.length, dependents });
    } catch (err) {
        serverError(res, "admin/delete-all-preview", err);
    }
});

router.post("/collections/:name/delete-all", async (req, res) => {
    try {
        const name = assertManaged(req.params.name);
        if (!name) return res.status(400).json({ error: "Unknown collection" });

        // The client has already shown the counts and taken a confirmation; this
        // flag makes the destructive call explicit rather than implied by the URL.
        if (req.body?.confirm !== true) {
            return res.status(400).json({ error: "Refusing to delete without confirm: true" });
        }

        const deleted: Record<string, number> = {};
        deleted[name] = await removeMany(name, await listAll(name));
        for (const dep of DEPENDENTS[name] ?? []) {
            deleted[dep] = await removeMany(dep, await listAll(dep));
        }

        console.warn(
            `admin/delete-all: ${req.principal?.email} deleted ${JSON.stringify(deleted)}`
        );
        res.json({ success: true, deleted });
    } catch (err) {
        serverError(res, "admin/delete-all", err);
    }
});

router.post("/import/:name", async (req, res) => {
    try {
        const name = String(req.params.name);
        if (!isImportable(name)) return res.status(400).json({ error: "Unknown collection" });

        const rows = req.body?.rows;
        if (!Array.isArray(rows)) return res.status(400).json({ error: "Missing rows" });

        const result = await importCollection(name, rows, req.principal?.email ?? "unknown");
        res.json(result);
    } catch (err) {
        serverError(res, "admin/import", err);
    }
});

router.post("/import-group-members", async (req, res) => {
    try {
        const { groupId, mode, rows } = req.body ?? {};
        if (!groupId || !mode || !Array.isArray(rows)) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        if (mode === "replace") {
            await removeMany("groupMembers", await byField("groupMembers", "groupId", String(groupId)));
        }

        const people = await listAll("people");
        const groupMembers = await listAll("groupMembers");
        const support = supportPersonIndex([
            ...people,
            ...rows.filter((r: Doc) => r.supportPersonName).map((r: Doc) => ({
                supportPersonName: r.supportPersonName,
            })),
        ]);
        const roles = groupRoleIndex(groupMembers);

        const byName = new Map<string, Doc>();
        for (const p of people) {
            byName.set(
                `${String(p.firstName ?? "").trim()}|${String(p.lastName ?? "").trim()}|${String(p.email ?? "").toLowerCase().trim()}`,
                p
            );
        }

        // (personId, groupId) -> existing membership, so the loop below needs no queries.
        const membershipIndex = new Map<string, Doc>();
        for (const gm of groupMembers) {
            membershipIndex.set(`${gm.personId}|${gm.groupId}`, gm);
        }

        const pending: { container: ContainerName; item: Doc }[] = [];
        let created = 0;
        let updated = 0;

        for (const row of rows as Doc[]) {
            const first = String(row.firstName ?? "").trim();
            const last = String(row.lastName ?? "").trim();
            if (!first && !last) continue;

            const email = String(row.email ?? "").trim();
            const existing = byName.get(`${first}|${last}|${email.toLowerCase()}`) ?? null;

            const supportName = String(row.supportPersonName ?? "").trim();
            let supportPersonId: string | null = null;
            if (supportName) {
                const [spFirst = "", ...spRest] = supportName.split(/\s+/);
                const match = people.find(
                    p =>
                        String(p.firstName ?? "").trim() === spFirst &&
                        String(p.lastName ?? "").trim() === spRest.join(" ")
                );
                if (match) supportPersonId = String(match.id);
            }

            const role = validGroupRole(row.role ?? row.type);
            // `qualifies` only - a `condition` column is refused, see import.ts.
            const qualifies = String(row.qualifies ?? "").trim() !== ""
                ? asQualifies(row.qualifies)
                : asQualifies(existing?.qualifies);
            const personId = existing ? String(existing.id) : newId();

            const type = resolvePersonType({
                currentType: row.type ?? existing?.type,
                qualifies,
                isSupportPerson: support.has(personId, first, last),
                groupRoles: [...roles.rolesFor(personId), role],
            });

            // Validated the same way the CSV importer validates it. This route
            // used to take whatever arrived, so a value refused through one
            // door was stored through the other. A rejection here is silent -
            // this response has no per-row log - but it is never substituted.
            const suppliedIds: Doc = {};
            for (const field of INFOODLE_ID_FIELDS) {
                const kept = acceptInfoodleId(row[field]).value ?? existing?.[field];
                if (kept !== undefined) suppliedIds[field] = kept;
            }

            const person: Doc = {
                ...(existing ?? {}),
                id: personId,
                // Falls back to what the person already had, never to our own
                // id - `personId` is a Cosmos id, meaningless to Infoodle.
                ...suppliedIds,
                firstName: first,
                lastName: last,
                email: email || existing?.email || null,
                type,
                qualifies,
                supportPersonName: supportName || null,
                // Existing people keep their code; only a genuinely new person gets one.
                accessCode: existing?.accessCode ?? generateAccessCode(),
                createdAt: existing?.createdAt ?? nowIso(),
                updatedAt: nowIso(),
            };
            if (supportPersonId) person.supportPersonId = supportPersonId;

            pending.push({ container: "people", item: person });
            existing ? updated++ : created++;

            // Looked up in the set already in memory. This was a query per row,
            // which is a network round trip per row on top of the two writes.
            const membership = membershipIndex.get(`${personId}|${groupId}`);
            pending.push({
                container: "groupMembers",
                item: membership
                    ? { ...membership, role, updatedAt: nowIso() }
                    : {
                          id: newId(),
                          personId,
                          groupId: String(groupId),
                          role,
                          createdAt: nowIso(),
                          updatedAt: nowIso(),
                      },
            });
        }

        // Decided above, written here - several at a time, and once per
        // document. See src/server/concurrency.ts for why.
        const deduped = new Map<string, { container: ContainerName; item: Doc }>();
        for (const entry of pending) deduped.set(`${entry.container}:${entry.item.id}`, entry);
        await mapLimit([...deduped.values()], DEFAULT_CONCURRENCY, entry =>
            upsert(entry.container, entry.item)
        );

        res.json({ success: true, created, updated });
    } catch (err) {
        serverError(res, "admin/import-group-members", err);
    }
});

// ---------------------------------------------------------------------------
// Backup and restore
// ---------------------------------------------------------------------------

/**
 * A full system backup.
 *
 * Unlike every other response, this DOES contain access codes - a restore that
 * dropped them would silently invalidate every magic link in circulation. The
 * file is therefore a credential store: see HANDOVER.md.
 */
router.get("/backup", async (req, res) => {
    try {
        const backup: Record<string, Doc[]> = {};
        for (const name of BACKUP_COLLECTIONS) {
            backup[name] = await listAll(name);
        }
        console.warn(`admin/backup: full backup downloaded by ${req.principal?.email}`);
        res.json(backup);
    } catch (err) {
        serverError(res, "admin/backup", err);
    }
});

router.post("/restore", async (req, res) => {
    try {
        const { backup, exactMirror } = req.body ?? {};
        if (!backup || typeof backup !== "object") {
            return res.status(400).json({ error: "Missing backup" });
        }

        const restored: Record<string, number> = {};
        const removed: Record<string, number> = {};

        for (const [name, docs] of Object.entries(backup)) {
            if (!Array.isArray(docs)) continue;
            if (!(CONTAINER_NAMES as readonly string[]).includes(name)) {
                return res.status(400).json({ error: `Unknown collection in backup: ${name}` });
            }
            const container = name as ContainerName;

            if (exactMirror === true) {
                const keep = new Set(docs.map((d: Doc) => d?.id).filter(Boolean));
                const surplus = (await listAll(container)).filter(d => !keep.has(d.id));
                removed[container] = await removeMany(container, surplus);
            }

            let count = 0;
            for (const doc of docs as Doc[]) {
                if (!doc || typeof doc !== "object") continue;
                const id = typeof doc.id === "string" && doc.id.trim() ? doc.id : newId();
                const incoming = { ...doc, id };
                // Exact mirror replaces the document; a merge restore leaves
                // fields the backup does not mention alone.
                const item =
                    exactMirror === true
                        ? incoming
                        : { ...((await getById(container, id)) ?? {}), ...incoming };
                await upsert(container, item);
                count++;
            }
            restored[container] = count;
        }

        console.warn(
            `admin/restore: ${req.principal?.email} restored ${JSON.stringify(restored)}` +
            (exactMirror ? ` (exact mirror, removed ${JSON.stringify(removed)})` : " (merge)")
        );
        res.json({ success: true, restored, removed, exactMirror: exactMirror === true });
    } catch (err) {
        serverError(res, "admin/restore", err);
    }
});

function assertManaged(name: unknown): ContainerName | null {
    const value = String(name ?? "");
    return (MANAGED as string[]).includes(value) ? (value as ContainerName) : null;
}

export default router;
