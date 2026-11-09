export interface Person {
    id: string;
    /**
     * Infoodle's internal `userId` - what POST /groups/attendance takes.
     *
     * Returned by groups/members and groups/membersforevent. NOT the number a
     * CSV export gives; see `infoodleUniqueId`.
     */
    infoodleId?: string;
    /**
     * Infoodle's profile `unique_id` - the one shown on a profile page, and the
     * only one a CSV export carries.
     *
     * Held separately because both are integers, so nothing but the column they
     * arrived in distinguishes them. Storing a `unique_id` in `infoodleId`
     * would post attendance against whoever holds that number as a `userId`.
     */
    infoodleUniqueId?: string;
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    accessCode: string;
    type: string;
    /**
     * Whether this person holds a condition that qualifies them as a member.
     *
     * Deliberately a boolean and not the diagnosis. The app only ever asked
     * whether there was one, and storing "MS" or "PD" against a named person
     * would make this health information about an identifiable individual.
     */
    qualifies?: boolean;
    supportPersonId?: string;
    supportPersonName?: string;
    createdAt?: any;
}

export interface Group {
    id: string;
    groupTypeId: string;
    name: string;
    dateRule: string;
    timeRule: string;
    who?: string;
    locationName: string;
    locationLink?: string;
}

export interface GroupType {
    id: string;
    shortValue: string;
    longValue: string;
}

export interface GroupMember {
    id?: string;
    groupId: string;
    personId: string;
    role: string;
}

export interface AppEvent {
    id: string;
    infoodleId?: string;
    groupId: string;
    title: string;
    date: string;
    time: string;
    duration: number;
    status: string;
    notes?: string;
    /** Free text from the leader on submission: anyone who came but is not in the group. Staff only. */
    extrasNote?: string;
    createdAt?: any;
    locationName?: string;
    locationLink?: string;
}

export interface Roster {
    id?: string;
    eventId: string;
    personId: string;
    role: string;
    rsvpStatus: string;
    attendanceStatus: string;
    note?: string;
    createdAt?: any;
    updatedAt?: any;
}
