import { Router } from "express";
import { parseEventDate } from "../../lib/dateUtils.js";
import {
    getAccessCode,
    verifyAccessCode,
    isLeaderOfGroup,
    publicPerson,
    publicPeople,
    serverError,
} from "../auth.js";
import {
    byField,
    byFieldIn,
    byFields,
    byIds,
    findById,
    getById,
    listAll,
    newId,
    nowIso,
    upsert,
    type Doc,
} from "../repo.js";

const router = Router();

/** Long enough for a session's worth of visitors; short enough not to become a record. */
const EXTRAS_NOTE_MAX = 2000;

/**
 * The member portal. Every route re-resolves the caller from their access code
 * and re-checks that the row being touched is theirs - an id in a request body
 * is a claim, never a permission.
 */

router.get("/data", async (req, res) => {
    try {
        const caller = await verifyAccessCode(getAccessCode(req));
        if (!caller) return res.status(401).json({ error: "Invalid access code" });

        const personId = caller.id;
        const personData = caller.data;

        // Discover linked people: the caller's own support person, and anyone
        // for whom the caller is the support person.
        const relevantIds = new Set<string>([personId]);
        if (personData.supportPersonId) relevantIds.add(String(personData.supportPersonId));
        for (const p of await byField("people", "supportPersonId", personId)) {
            relevantIds.add(String(p.id));
        }

        const people = await byIds("people", [...relevantIds]);

        // Memberships and existing rosters for all relevant people. Firestore's
        // `in` capped at 30 values and needed chunking; ARRAY_CONTAINS does not.
        const ids = [...relevantIds];
        let myGroupMembers = await byFieldIn("groupMembers", "personId", ids);
        const myRostersByPerson = await byFieldIn("rosters", "personId", ids);

        // Fallback for legacy Airtable structure where membership lived on the person doc.
        if (myGroupMembers.length === 0) {
            myGroupMembers = legacyMemberships(people);
        }

        const myGroupIds = unique(myGroupMembers.map(gm => gm.groupId));
        const myRosterEventIds = unique(myRostersByPerson.map(r => r.eventId));

        // Events reachable either through a group or through a direct roster entry.
        const eventsMap = new Map<string, Doc>();
        for (const e of await byFieldIn("events", "groupId", myGroupIds)) {
            eventsMap.set(String(e.id), e);
        }
        for (const e of await byIds("events", myRosterEventIds)) {
            if (!eventsMap.has(String(e.id))) eventsMap.set(String(e.id), e);
        }

        const todayStart = startOfToday();
        const thirtyDaysAhead = addDays(todayStart, 30);

        const events = [...eventsMap.values()].filter(e => {
            const eventDate = parseEventDate(e.date || "");
            const status = String(e.status || "").toLowerCase();
            const rosterStatus = String(e.rosterStatus || "").toLowerCase();

            if (status === "cancelled") return false;

            const isFinished =
                ["submitted", "complete", "completed", "approved", "exported"].includes(status) ||
                ["submitted", "complete", "completed"].includes(rosterStatus);

            return eventDate >= todayStart && eventDate <= thirtyDaysAhead && !isFinished;
        });

        // Only the caller's own rows and their linked people's. The whole event
        // roster would hand every member everyone else's attendance and notes -
        // and leaders write medical alerts into notes.
        const rosters = (await byFieldIn("rosters", "eventId", events.map(e => e.id))).filter(r =>
            relevantIds.has(String(r.personId))
        );
        const groups = await byIds("groups", unique(events.map(e => e.groupId)));

        res.json({
            person: publicPerson({ ...personData, id: personId }),
            rosters,
            events: events.map(withoutExtrasNote),
            groupMembers: myGroupMembers,
            groups,
            people: publicPeople(people),
        });
    } catch (err) {
        serverError(res, "portal/data", err);
    }
});

router.post("/action", async (req, res) => {
    try {
        const { eventId, targetPersonId, action, value } = req.body ?? {};
        if (!eventId || !targetPersonId || !action) {
            return res.status(400).json({ error: "Missing fields" });
        }

        const caller = await verifyAccessCode(getAccessCode(req));
        if (!caller) return res.status(401).json({ error: "Invalid access code" });

        const event = await findById("events", String(eventId));
        if (!event) return res.status(404).json({ error: "Event not found" });

        const groupId = event.groupId ? String(event.groupId) : undefined;
        const isLeader = await isLeaderOfGroup(caller, groupId);

        if (!(await mayActOnBehalfOf(caller.id, String(targetPersonId), isLeader ? groupId ?? null : null))) {
            return res.status(403).json({ error: "Forbidden" });
        }

        await writeRosterAction({
            eventId: String(eventId),
            personId: String(targetPersonId),
            action: String(action),
            value,
            // Attendance is a leader's call; a member may only set their own RSVP and note.
            allowAttendance: isLeader,
        });

        res.json({ success: true });
    } catch (err) {
        serverError(res, "portal/action", err);
    }
});

router.post("/submit-attendance", async (req, res) => {
    try {
        const { eventId, extrasNote } = req.body ?? {};
        if (!eventId) return res.status(400).json({ error: "Missing fields" });

        const caller = await verifyAccessCode(getAccessCode(req));
        if (!caller) return res.status(401).json({ error: "Invalid access code" });

        const event = await findById("events", String(eventId));
        if (!event) return res.status(404).json({ error: "Event not found" });

        if (!(await isLeaderOfGroup(caller, event.groupId ? String(event.groupId) : undefined))) {
            return res.status(403).json({ error: "Forbidden: Not a leader" });
        }

        // Anyone who came but is not in the group goes here as free text, for
        // staff to follow up in Infoodle. Leaders do not create person records.
        const extras = typeof extrasNote === "string" ? extrasNote.trim().slice(0, EXTRAS_NOTE_MAX) : "";

        await upsert("events", {
            ...event,
            rosterStatus: "submitted",
            status: "submitted",
            ...(extras ? { extrasNote: extras } : {}),
            updatedAt: nowIso(),
        });

        res.json({ success: true });
    } catch (err) {
        serverError(res, "portal/submit-attendance", err);
    }
});

// ---------------------------------------------------------------------------
// Shared by the portal and leader routes
// ---------------------------------------------------------------------------

/**
 * May the caller act for this person? Everybody may act for themselves and for
 * the person on the other end of a support-person link, checked in both
 * directions. A leader may also act for anyone in the group - pass the group
 * only once the caller is known to lead it.
 *
 * "Anyone at all" is not enough for leaders: acting for someone writes them a
 * roster row, and attendance is recorded for the group only. Anyone else who
 * came goes in the extras note on submission.
 */
export async function mayActOnBehalfOf(
    callerId: string,
    targetPersonId: string,
    groupTheyLead: string | null
): Promise<boolean> {
    if (callerId === targetPersonId) return true;
    if (groupTheyLead && (await isInGroupReach(groupTheyLead, targetPersonId))) return true;

    const caller = await getById("people", callerId);
    if (caller?.supportPersonId === targetPersonId) return true;

    const target = await getById("people", targetPersonId);
    return target?.supportPersonId === callerId;
}

async function isInGroupReach(groupId: string, personId: string): Promise<boolean> {
    // Most targets are plain members, and one query settles those.
    if ((await byFields("groupMembers", { groupId, personId })).length > 0) return true;
    const { reach } = await groupReach([groupId]);
    return reach.get(groupId)?.has(personId) ?? false;
}

/**
 * Who is "in" each group: its members, and the person on the other end of each
 * member's support-person link. Carers are rarely members themselves, and the
 * leader's roster pairs each member with theirs.
 *
 * The one definition behind both what a leader sees and whom they may act for,
 * so a leader can act for exactly the people on their screen.
 */
export async function groupReach(
    groupIds: readonly string[]
): Promise<{ groupMembers: Doc[]; reach: Map<string, Set<string>> }> {
    let groupMembers = await byFieldIn("groupMembers", "groupId", groupIds);
    if (groupIds.length > 0 && groupMembers.length === 0) {
        // Legacy Airtable structure: membership lived on the person doc.
        groupMembers = legacyMemberships(await listAll("people")).filter(gm =>
            groupIds.includes(String(gm.groupId))
        );
    }

    const memberIds = unique(groupMembers.map(gm => String(gm.personId)));
    // Two independent reads; in parallel, they cost one round trip to Auckland.
    const [members, supporters] = await Promise.all([
        byIds("people", memberIds),
        byFieldIn("people", "supportPersonId", memberIds),
    ]);

    const linked = new Map<string, string[]>();
    const link = (memberId: string, otherId: string) =>
        linked.set(memberId, [...(linked.get(memberId) ?? []), otherId]);
    for (const m of members) if (m.supportPersonId) link(String(m.id), String(m.supportPersonId));
    for (const s of supporters) link(String(s.supportPersonId), String(s.id));

    const reach = new Map(groupIds.map(g => [g, new Set<string>()]));
    for (const gm of groupMembers) {
        const inGroup = reach.get(String(gm.groupId));
        if (!inGroup) continue;
        inGroup.add(String(gm.personId));
        for (const other of linked.get(String(gm.personId)) ?? []) inGroup.add(other);
    }
    return { groupMembers, reach };
}

/** The extras note can name people outside the group. It is for staff, not members. */
function withoutExtrasNote(event: Doc): Doc {
    const { extrasNote, ...rest } = event;
    void extrasNote;
    return rest;
}

/**
 * Create or update the roster row for one person at one event.
 *
 * Roster rows are partitioned by eventId and have no natural id, so the
 * existing row is found by (eventId, personId) rather than addressed directly.
 */
export async function writeRosterAction(opts: {
    eventId: string;
    personId: string;
    action: string;
    value: unknown;
    allowAttendance: boolean;
}): Promise<void> {
    const { eventId, personId, action, value, allowAttendance } = opts;

    const existing = (await byFields("rosters", { eventId, personId }))[0];
    const updates: Doc = existing
        ? { ...existing, updatedAt: nowIso() }
        : {
              id: newId(),
              eventId,
              personId,
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
        // Un-booking someone who was marked a no-show clears the no-show too,
        // so the record does not keep accusing them of missing a booking they cancelled.
        if (currentRsvp === "booked" && currentAttendance === "no-show" && value !== "booked") {
            updates.attendanceStatus = "unknown";
        }
    }
    if (action === "attendance" && allowAttendance) updates.attendanceStatus = value;
    if (action === "note") updates.note = value;

    await upsert("rosters", updates);
}

export function legacyMemberships(people: readonly Doc[]): Doc[] {
    const out: Doc[] = [];
    for (const p of people) {
        const groups = Array.isArray(p.Group) ? p.Group
            : Array.isArray(p.group) ? p.group
            : typeof p.groupId === "string" ? [p.groupId] : [];
        for (const gId of groups) {
            out.push({
                id: `gm_${p.id}_${gId}`,
                personId: p.id,
                groupId: gId,
                role: p.type || p.role || "member",
            });
        }
    }
    return out;
}

export function unique<T>(values: readonly T[]): T[] {
    return [...new Set(values)].filter(Boolean) as T[];
}

export function startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

export function addDays(from: Date, days: number): Date {
    const d = new Date(from);
    d.setDate(d.getDate() + days);
    d.setHours(23, 59, 59, 999);
    return d;
}

export default router;
