import { Roster, Person, GroupMember } from "../types";

/**
 * Apply an optimistic RSVP / attendance / note change to a rosters array, returning a new array.
 * If no roster exists for the event+person yet, a temporary one is appended. Shared by the admin,
 * portal, and leader views so their optimistic updates stay in lockstep.
 */
export function applyOptimisticRosterUpdate(
    rosters: Roster[],
    eventId: string,
    personId: string,
    action: string,
    value: string
): Roster[] {
    const index = rosters.findIndex(r => r.eventId === eventId && r.personId === personId);
    if (index > -1) {
        const updated = [...rosters];
        const currentRsvp = updated[index].rsvpStatus || 'potential';
        const currentAttend = updated[index].attendanceStatus || 'unknown';

        let newRsvp = currentRsvp;
        let newAttend = currentAttend;
        let newNote = updated[index].note || '';

        if (action === 'rsvp') {
            newRsvp = value;
            if (currentRsvp === 'booked' && currentAttend === 'no-show' && value !== 'booked') {
                newAttend = 'unknown';
            }
        } else if (action === 'attendance') {
            newAttend = value;
        } else if (action === 'note') {
            newNote = value;
        }

        updated[index] = { ...updated[index], rsvpStatus: newRsvp, attendanceStatus: newAttend, note: newNote };
        return updated;
    }

    return [...rosters, {
        id: `temp-${Date.now()}`,
        eventId,
        personId,
        role: 'member',
        rsvpStatus: action === 'rsvp' ? value : 'potential',
        attendanceStatus: action === 'attendance' ? value : 'unknown',
        note: action === 'note' ? value : ''
    }];
}

/** Resolve the correct magic-link (leader vs member portal) for a person, based on type and group roles. */
export function resolveAccessLink(
    person: Pick<Person, "id" | "type" | "accessCode">,
    groupMembers: GroupMember[]
): { url: string; label: string } {
    const pType = String(person.type || "").toLowerCase();
    if (pType === 'staff' || pType === 'admin') {
        return { url: `/leader/${person.accessCode}`, label: "Leader Link" };
    }
    const hasLeaderRole = groupMembers
        .filter(gm => gm.personId === person.id)
        .some(gm => ['leader', 'staff', 'admin'].includes(String(gm.role).toLowerCase()));
    return hasLeaderRole
        ? { url: `/leader/${person.accessCode}`, label: "Leader Link" }
        : { url: `/portal/${person.accessCode}`, label: "Login Link" };
}
