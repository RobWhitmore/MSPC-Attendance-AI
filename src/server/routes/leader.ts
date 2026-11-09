import { Router } from "express";
import { parseEventDate } from "../../lib/dateUtils.js";
import { getAccessCode, verifyAccessCode, publicPerson, leaderViewOfPerson, serverError } from "../auth.js";
import { byField, byFieldIn, byIds, listAll, nowIso, upsert, type Doc } from "../repo.js";
import { groupReach, legacyMemberships, unique, startOfToday, addDays } from "./portal.js";

const router = Router();

const LEADER_ROLES = ["leader", "staff", "admin"];
const FINISHED_STATUSES = ["submitted", "complete", "completed", "approved", "exported"];

router.get("/data", async (req, res) => {
    try {
        const caller = await verifyAccessCode(getAccessCode(req));
        if (!caller) return res.status(401).json({ error: "Invalid access code" });

        const personId = caller.id;
        const personData = caller.data;
        const role = String(personData.type || "").toLowerCase();
        const isStaff = ["staff", "admin"].includes(role);

        // Which groups does this person lead?
        let leaderGroupIds: string[] = [];
        if (!isStaff) {
            const myMemberships = await byField("groupMembers", "personId", personId);
            leaderGroupIds = myMemberships
                .filter(m => LEADER_ROLES.includes(String(m.role || "").toLowerCase()))
                .map(m => String(m.groupId));

            // Fallback to legacy Airtable structure.
            if (leaderGroupIds.length === 0 && LEADER_ROLES.includes(role)) {
                leaderGroupIds = legacyMemberships([{ ...personData, id: personId }]).map(
                    gm => String(gm.groupId)
                );
            }

            if (leaderGroupIds.length === 0) {
                // Not a leader of anything yet. Empty rather than 403 - this is a
                // person with no leadership, not a refused request.
                return res.json({
                    person: publicPerson({ ...personData, id: personId }),
                    events: [],
                    groupMembers: [],
                    rosters: [],
                    people: [],
                    groups: [],
                });
            }
        }

        // Dates are stored as strings in assorted formats, so they cannot be
        // range-queried; fetch by group and filter in memory.
        let events = isStaff
            ? await listAll("events")
            : await byFieldIn("events", "groupId", leaderGroupIds);

        const todayStart = startOfToday();
        const thirtyDaysAgo = new Date(todayStart);
        thirtyDaysAgo.setDate(todayStart.getDate() - 30);
        const thirtyDaysAhead = addDays(todayStart, 30);

        // Everything in the coming 30 days, plus anything in the last 30 days
        // that still has not been submitted.
        events = events.filter(e => {
            const eventDate = parseEventDate(e.date || "");
            const isUpcoming = eventDate >= todayStart && eventDate <= thirtyDaysAhead;
            const isPastInRange = eventDate < todayStart && eventDate >= thirtyDaysAgo;
            return isUpcoming || (isPastInRange && !isFinished(e));
        });

        const relevantGroupIds = unique(events.map(e => e.groupId));

        const [{ groupMembers: memberships, reach }, allRosters] = await Promise.all([
            groupReach(relevantGroupIds),
            byFieldIn("rosters", "eventId", events.map(e => e.id)),
        ]);

        // Carers are part of the group and may come without their member, so
        // each one reached through a support link is listed as in the group.
        // Derived, never written: the support link is the record of fact.
        const groupMembers = [...memberships];
        for (const [groupId, inGroup] of reach) {
            const listed = new Set(memberships.filter(gm => gm.groupId === groupId).map(gm => String(gm.personId)));
            for (const carerId of inGroup) {
                if (listed.has(carerId)) continue;
                groupMembers.push({ id: `gm_${carerId}_${groupId}`, groupId, personId: carerId, role: "support" });
            }
        }

        // Attendance is recorded for the group only. A roster row for anyone
        // else - someone who booked themselves onto another group's event -
        // is not the leader's to see.
        const groupOfEvent = new Map(events.map(e => [String(e.id), String(e.groupId)]));
        const rosters = allRosters.filter(r =>
            reach.get(groupOfEvent.get(String(r.eventId)) ?? "")?.has(String(r.personId))
        );

        await prepopulateAttendance(events, groupMembers, rosters);

        const people = await byIds("people", unique(groupMembers.map(gm => String(gm.personId))));
        const groups = await byIds("groups", relevantGroupIds);

        res.json({
            person: publicPerson({ ...personData, id: personId }),
            events,
            groupMembers,
            rosters,
            // A leader sees who is in their groups - names and roles, never
            // access codes or contact details. The Firebase version spread
            // whole person documents here.
            people: people.map(leaderViewOfPerson),
            groups,
        });
    } catch (err) {
        serverError(res, "leader/data", err);
    }
});

function isFinished(event: Doc): boolean {
    const status = String(event.status || "").toLowerCase();
    const rosterStatus = String(event.rosterStatus || "").toLowerCase();
    return (
        FINISHED_STATUSES.includes(status) ||
        ["submitted", "complete", "completed"].includes(rosterStatus)
    );
}

/**
 * Seed attendance for events that have come due, so a leader opens the roster
 * to "everyone who booked is present" rather than to a blank sheet.
 *
 * Runs once per event, guarded by `attendanceAutoPopulated`. Mutates the arrays
 * it is given so the caller returns the seeded state rather than the stale one.
 */
async function prepopulateAttendance(
    events: Doc[],
    groupMembers: readonly Doc[],
    rosters: Doc[]
): Promise<void> {
    const today = startOfToday();

    for (const event of events) {
        const eventDate = parseEventDate(event.date || "");
        eventDate.setHours(0, 0, 0, 0);

        const isDue = eventDate.getTime() <= today.getTime() && !isFinished(event);
        if (!isDue || event.attendanceAutoPopulated) continue;

        for (const gm of groupMembers.filter(g => g.groupId === event.groupId)) {
            const roster = rosters.find(r => r.eventId === event.id && r.personId === gm.personId);
            const rsvpStatus = String(roster?.rsvpStatus || "potential");
            const current = String(roster?.attendanceStatus || "unknown");

            let next = current;
            if (rsvpStatus === "booked") next = "present";
            else if (rsvpStatus === "cancelled") next = "cancelled";
            if (next === current) continue;

            try {
                if (roster) {
                    roster.attendanceStatus = next;
                    roster.updatedAt = nowIso();
                    await upsert("rosters", roster);
                } else {
                    const created = {
                        id: `${event.id}_${gm.personId}`,
                        eventId: String(event.id),
                        personId: String(gm.personId),
                        rsvpStatus: "potential",
                        attendanceStatus: next,
                        role: gm.role || "member",
                        createdAt: nowIso(),
                        updatedAt: nowIso(),
                    };
                    await upsert("rosters", created);
                    rosters.push(created);
                }
            } catch (err) {
                // One bad row must not cost the leader the whole page.
                console.error(`leader/data: failed to pre-populate attendance for ${gm.personId}:`, err);
            }
        }

        try {
            event.attendanceAutoPopulated = true;
            event.updatedAt = nowIso();
            await upsert("events", event);
        } catch (err) {
            console.error(`leader/data: failed to set auto-populated flag on event ${event.id}:`, err);
        }
    }
}

export default router;
