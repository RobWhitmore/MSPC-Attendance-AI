import { test, describe, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import * as fakeRepo from "./fake-repo.js";

/**
 * The routes, run for real.
 *
 * Only the data layer is substituted (see fake-repo.ts) - the Express app, the
 * routers, the auth gate, the classification rules and `publicPerson` are the
 * shipping code. These are the assertions that would otherwise wait for a
 * deployed environment, and they cover the part where a mistake is a data leak
 * rather than a broken page.
 */

mock.module("../src/server/repo.js", { namedExports: fakeRepo as any });

let server: Server;
let baseUrl: string;

const MEMBER_CODE = "MEMBERCODE01";
const SUPPORT_CODE = "SUPPORTCODE1";
const LEADER_CODE = "LEADERCODE01";
const OUTSIDER_CODE = "OUTSIDERCODE";

/** Seed data: one group, a member, their support person, a leader, and an unrelated person. */
function baseData() {
    return {
        people: [
            { id: "p-member", firstName: "Mary", lastName: "Member", accessCode: MEMBER_CODE, type: "member", qualifies: true, supportPersonId: "p-support" },
            { id: "p-support", firstName: "Sam", lastName: "Support", accessCode: SUPPORT_CODE, type: "support" },
            { id: "p-leader", firstName: "Lee", lastName: "Leader", accessCode: LEADER_CODE, type: "external" },
            { id: "p-outsider", firstName: "Otto", lastName: "Outsider", accessCode: OUTSIDER_CODE, type: "external" },
        ],
        groups: [{ id: "g1", name: "Tuesday Group", groupTypeId: "gt1" }],
        groupTypes: [{ id: "gt1", shortValue: "TUE", longValue: "Tuesday" }],
        events: [{ id: "e1", groupId: "g1", title: "Session", date: futureDate(), time: "10:00", status: "active" }],
        groupMembers: [
            { id: "gm1", groupId: "g1", personId: "p-member", role: "member" },
            { id: "gm2", groupId: "g1", personId: "p-leader", role: "leader" },
        ],
        rosters: [{ id: "r1", eventId: "e1", personId: "p-member", rsvpStatus: "potential", attendanceStatus: "unknown", role: "member" }],
        admins: [{ id: "admin@mspc.org.nz", email: "admin@mspc.org.nz", role: "superadmin" }],
        auditLogs: [],
    };
}

/** The portal only returns events inside a 30-day window, so the fixture has to be in it. */
function futureDate(): string {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().slice(0, 10);
}

function principalHeader(email: string): Record<string, string> {
    return {
        "x-ms-client-principal": Buffer.from(
            JSON.stringify({ identityProvider: "aad", userId: "u1", userDetails: email, userRoles: ["authenticated"] })
        ).toString("base64"),
    };
}

async function call(path: string, init: RequestInit = {}) {
    const res = await fetch(`${baseUrl}${path}`, init);
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, text, body };
}

const json = (payload: unknown, headers: Record<string, string> = {}) => ({
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload),
});

before(async () => {
    process.env.AUTH_MODE = "swa";
    process.env.ADMIN_EMAIL_DOMAINS = "mspc.org.nz";
    const { createApp } = await import("../src/server/app.js");
    server = createServer(createApp());
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server?.close());

beforeEach(() => fakeRepo.seed(baseData()));

// ---------------------------------------------------------------------------

describe("the API is not open", () => {
    test("portal data is refused without an access code", async () => {
        assert.equal((await call("/api/portal/data")).status, 401);
    });

    test("portal data is refused with an unknown access code", async () => {
        const res = await call("/api/portal/data", { headers: { "x-access-code": "NOPE" } });
        assert.equal(res.status, 401);
    });

    test("leader data is refused without an access code", async () => {
        assert.equal((await call("/api/leader/data")).status, 401);
    });

    test("admin data is refused without a principal", async () => {
        assert.equal((await call("/api/admin/data/People")).status, 403);
    });

    test("admin backup is refused without a principal", async () => {
        assert.equal((await call("/api/admin/backup")).status, 403);
    });

    test("an access code does NOT open the admin API", async () => {
        // The two mechanisms are separate. A leader's code must not reach admin routes.
        const res = await call("/api/admin/data/People", { headers: { "x-access-code": LEADER_CODE } });
        assert.equal(res.status, 403);
    });
});

describe("admin authorisation", () => {
    test("a non-allowlisted domain is refused even with a valid principal", async () => {
        const res = await call("/api/admin/data/People", { headers: principalHeader("someone@gmail.com") });
        assert.equal(res.status, 403);
    });

    test("an allowlisted domain with no admins record is refused", async () => {
        const res = await call("/api/admin/data/People", { headers: principalHeader("nobody@mspc.org.nz") });
        assert.equal(res.status, 403);
    });

    test("an allowlisted domain with an admins record is admitted", async () => {
        const res = await call("/api/admin/data/People", { headers: principalHeader("admin@mspc.org.nz") });
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.body.people));
    });

    test("the email is matched case-insensitively", async () => {
        const res = await call("/api/admin/data/People", { headers: principalHeader("Admin@MSPC.org.nz") });
        assert.equal(res.status, 200);
    });

    test("an empty allowlist denies everyone", async () => {
        process.env.ADMIN_EMAIL_DOMAINS = "";
        const res = await call("/api/admin/data/People", { headers: principalHeader("admin@mspc.org.nz") });
        process.env.ADMIN_EMAIL_DOMAINS = "mspc.org.nz";
        assert.equal(res.status, 403);
    });

    test("/me explains why rather than just refusing", async () => {
        const res = await call("/api/admin/me", { headers: principalHeader("nobody@mspc.org.nz") });
        assert.equal(res.status, 200);
        assert.equal(res.body.isAdmin, false);
        assert.equal(res.body.reason, "no-admin-record");
    });
});

describe("access codes never leave the server", () => {
    test("the portal returns no access code, not even the caller's own", async () => {
        const res = await call("/api/portal/data", { headers: { "x-access-code": MEMBER_CODE } });
        assert.equal(res.status, 200);
        assert.equal(res.text.includes("accessCode"), false);
        assert.equal(res.text.includes(SUPPORT_CODE), false);
    });

    test("a leader sees their group without seeing anyone's code", async () => {
        // This is the leak the Firebase version had: whole person documents were
        // spread into the response, so one leader's link exposed every code.
        const res = await call("/api/leader/data", { headers: { "x-access-code": LEADER_CODE } });
        assert.equal(res.status, 200);
        assert.ok(res.body.people.length > 0, "the leader should see people");
        assert.equal(res.text.includes("accessCode"), false);
        assert.equal(res.text.includes(MEMBER_CODE), false);
    });

    test("the admin people list carries no codes", async () => {
        const res = await call("/api/admin/data/People", { headers: principalHeader("admin@mspc.org.nz") });
        // Assert the request succeeded first: a refusal contains no access code
        // either, and would make this pass while proving nothing.
        assert.equal(res.status, 200);
        assert.equal(res.body.people.length, 4);
        assert.equal(res.text.includes("accessCode"), false);
    });

    test("a code in the query string is not accepted", async () => {
        // Query strings reach platform access logs; the header is the only way in.
        const res = await call(`/api/portal/data?accessCode=${MEMBER_CODE}`);
        assert.equal(res.status, 401);
    });
});

describe("an id in a request is a claim, not a permission", () => {
    test("a member may act for themselves", async () => {
        const res = await call("/api/portal/action", json(
            { eventId: "e1", targetPersonId: "p-member", action: "rsvp", value: "booked" },
            { "x-access-code": MEMBER_CODE }
        ));
        assert.equal(res.status, 200);
        assert.equal(fakeRepo.dump("rosters").find(r => r.id === "r1")?.rsvpStatus, "booked");
    });

    test("a member may act for the person they support", async () => {
        const res = await call("/api/portal/action", json(
            { eventId: "e1", targetPersonId: "p-support", action: "rsvp", value: "booked" },
            { "x-access-code": MEMBER_CODE }
        ));
        assert.equal(res.status, 200);
    });

    test("a member may NOT act for an unrelated person", async () => {
        const res = await call("/api/portal/action", json(
            { eventId: "e1", targetPersonId: "p-outsider", action: "rsvp", value: "booked" },
            { "x-access-code": MEMBER_CODE }
        ));
        assert.equal(res.status, 403);
    });

    test("an outsider may not act for a member", async () => {
        const res = await call("/api/portal/action", json(
            { eventId: "e1", targetPersonId: "p-member", action: "rsvp", value: "cancelled" },
            { "x-access-code": OUTSIDER_CODE }
        ));
        assert.equal(res.status, 403);
        assert.equal(fakeRepo.dump("rosters").find(r => r.id === "r1")?.rsvpStatus, "potential");
    });

    test("a leader may act for anyone in their group", async () => {
        const res = await call("/api/portal/action", json(
            { eventId: "e1", targetPersonId: "p-member", action: "attendance", value: "present" },
            { "x-access-code": LEADER_CODE }
        ));
        assert.equal(res.status, 200);
        assert.equal(fakeRepo.dump("rosters").find(r => r.id === "r1")?.attendanceStatus, "present");
    });

    test("a member may not set attendance, only a leader may", async () => {
        const res = await call("/api/portal/action", json(
            { eventId: "e1", targetPersonId: "p-member", action: "attendance", value: "present" },
            { "x-access-code": MEMBER_CODE }
        ));
        assert.equal(res.status, 200, "the request is allowed");
        assert.equal(
            fakeRepo.dump("rosters").find(r => r.id === "r1")?.attendanceStatus,
            "unknown",
            "but attendance must be unchanged"
        );
    });

    test("submitting attendance requires being a leader", async () => {
        const refused = await call("/api/portal/submit-attendance", json(
            { eventId: "e1" }, { "x-access-code": MEMBER_CODE }
        ));
        assert.equal(refused.status, 403);

        const allowed = await call("/api/portal/submit-attendance", json(
            { eventId: "e1" }, { "x-access-code": LEADER_CODE }
        ));
        assert.equal(allowed.status, 200);
    });

    test("a leader may NOT act for someone outside their group", async () => {
        // Acting for someone writes them a roster row, and a roster row puts
        // their whole record in the leader's view.
        const res = await call("/api/portal/action", json(
            { eventId: "e1", targetPersonId: "p-outsider", action: "rsvp", value: "booked" },
            { "x-access-code": LEADER_CODE }
        ));
        assert.equal(res.status, 403);
        assert.equal(fakeRepo.dump("rosters").some(r => r.personId === "p-outsider"), false);

        const view = await call("/api/leader/data", { headers: { "x-access-code": LEADER_CODE } });
        assert.equal(view.status, 200);
        assert.equal(view.text.includes("Otto"), false);
    });

    test("a leader may NOT act for someone rostered onto the event from outside the group", async () => {
        // Attendance is recorded for the group only; a roster row is not membership.
        const data = baseData();
        data.rosters.push({ id: "r-otto", eventId: "e1", personId: "p-outsider", rsvpStatus: "booked", attendanceStatus: "unknown", role: "member" });
        fakeRepo.seed(data);

        const res = await call("/api/portal/action", json(
            { eventId: "e1", targetPersonId: "p-outsider", action: "attendance", value: "present" },
            { "x-access-code": LEADER_CODE }
        ));
        assert.equal(res.status, 403);
        assert.equal(fakeRepo.dump("rosters").find(r => r.id === "r-otto")?.attendanceStatus, "unknown");

        const view = await call("/api/leader/data", { headers: { "x-access-code": LEADER_CODE } });
        assert.equal(view.body.rosters.some((r: any) => r.id === "r-otto"), false);
        assert.equal(view.text.includes("Otto"), false);
    });

    test("a carer is part of the group, and may attend without their member", async () => {
        // Sam is Mary's carer and not a group member. Mary has not booked.
        const view = await call("/api/leader/data", { headers: { "x-access-code": LEADER_CODE } });
        assert.equal(view.status, 200);
        const sam = view.body.groupMembers.find((gm: any) => gm.personId === "p-support");
        assert.ok(sam, "the carer should be listed in the group");
        assert.equal(sam.role, "support");
        assert.ok(view.body.people.some((p: any) => p.id === "p-support"));

        const res = await call("/api/portal/action", json(
            { eventId: "e1", targetPersonId: "p-support", action: "attendance", value: "present" },
            { "x-access-code": LEADER_CODE }
        ));
        assert.equal(res.status, 200);
        const rows = fakeRepo.dump("rosters");
        assert.equal(rows.find(r => r.personId === "p-support")?.attendanceStatus, "present");
        assert.equal(rows.find(r => r.personId === "p-member")?.attendanceStatus, "unknown", "Mary is untouched");
    });

    test("leaders create no person records: there is no walk-in route", async () => {
        const before = fakeRepo.dump("people").length;
        const res = await call("/api/portal/add-temp-attendee", json(
            { eventId: "e1", firstName: "Wally", lastName: "Walkin", type: "member", phone: "022 555 0199" },
            { "x-access-code": LEADER_CODE }
        ));
        assert.equal(res.status, 404);
        assert.equal(fakeRepo.dump("people").length, before);

        const approve = await call("/api/portal/approve-temp-person", json(
            { eventId: "e1", targetPersonId: "p-outsider" },
            { "x-access-code": LEADER_CODE }
        ));
        assert.equal(approve.status, 404);
        assert.equal(fakeRepo.dump("people").find(p => p.id === "p-outsider")?.type, "external");
    });
});

describe("extras are a note to staff, not a record", () => {
    test("submitting stores the extras note on the event", async () => {
        const res = await call("/api/portal/submit-attendance", json(
            { eventId: "e1", extrasNote: "  2 visitors; Jane, interested in joining  " },
            { "x-access-code": LEADER_CODE }
        ));
        assert.equal(res.status, 200);
        const event = fakeRepo.dump("events").find(e => e.id === "e1");
        assert.equal(event?.status, "submitted");
        assert.equal(event?.extrasNote, "2 visitors; Jane, interested in joining");
    });

    test("an over-long extras note is cut, not refused", async () => {
        await call("/api/portal/submit-attendance", json(
            { eventId: "e1", extrasNote: "x".repeat(5000) },
            { "x-access-code": LEADER_CODE }
        ));
        assert.equal(fakeRepo.dump("events").find(e => e.id === "e1")?.extrasNote.length, 2000);
    });

    test("a member may not submit, so may not write an extras note", async () => {
        const res = await call("/api/portal/submit-attendance", json(
            { eventId: "e1", extrasNote: "hello" }, { "x-access-code": MEMBER_CODE }
        ));
        assert.equal(res.status, 403);
        assert.equal("extrasNote" in (fakeRepo.dump("events").find(e => e.id === "e1") ?? {}), false);
    });

    test("members never receive the extras note", async () => {
        // It can name people outside the group. Submitted events already drop
        // out of the member's view; this covers one an admin has reopened.
        const data = baseData();
        Object.assign(data.events[0], { extrasNote: "Jane Visitor, 021 555 0123" });
        fakeRepo.seed(data);

        const res = await call("/api/portal/data", { headers: { "x-access-code": MEMBER_CODE } });
        assert.equal(res.status, 200);
        assert.equal(res.body.events.length, 1, "the event itself is still shown");
        assert.equal(res.text.includes("extrasNote"), false);
        assert.equal(res.text.includes("Jane Visitor"), false);
    });
});

describe("each screen receives what it draws, not the whole record", () => {
    test("a member does not receive other members' roster rows or notes", async () => {
        const data = baseData();
        data.rosters.push({ id: "r-other", eventId: "e1", personId: "p-other", rsvpStatus: "booked", attendanceStatus: "unknown", role: "member", note: "Fell last week, uses a walker" } as any);
        fakeRepo.seed(data);

        const res = await call("/api/portal/data", { headers: { "x-access-code": MEMBER_CODE } });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.rosters.map((r: any) => r.id), ["r1"]);
        assert.equal(res.text.includes("walker"), false);
    });

    test("a leader receives no member's contact details, flags or Infoodle ids", async () => {
        const data = baseData();
        Object.assign(data.people[0], { email: "mary@example.org", phone: "021 555 0101", infoodleId: "4021", infoodleUniqueId: "88" });
        fakeRepo.seed(data);

        const res = await call("/api/leader/data", { headers: { "x-access-code": LEADER_CODE } });
        assert.equal(res.status, 200);
        const mary = res.body.people.find((p: any) => p.id === "p-member");
        assert.ok(mary, "the leader should still see the member");
        assert.equal(mary.firstName, "Mary");
        assert.equal(mary.supportPersonId, "p-support", "the carer pairing is still drawn");
        for (const field of ["email", "phone", "qualifies", "infoodleId", "infoodleUniqueId", "accessCode"]) {
            assert.equal(field in mary, false, `${field} should not reach a leader`);
        }
    });
});

describe("admin writes", () => {
    const asAdmin = principalHeader("admin@mspc.org.nz");

    test("a person can be updated, but not their access code", async () => {
        const res = await call("/api/admin/people/p-member", {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...asAdmin },
            body: JSON.stringify({ firstName: "Renamed", accessCode: "HACKED" }),
        });
        assert.equal(res.status, 200);

        const person = fakeRepo.dump("people").find(p => p.id === "p-member");
        assert.equal(person?.firstName, "Renamed");
        assert.equal(person?.accessCode, MEMBER_CODE, "the code must be unchanged");
    });

    test("deleting a person takes their memberships and rosters with them", async () => {
        const res = await call("/api/admin/people/p-member", { method: "DELETE", headers: asAdmin });
        assert.equal(res.status, 200);

        assert.equal(fakeRepo.dump("people").some(p => p.id === "p-member"), false);
        assert.equal(fakeRepo.dump("groupMembers").some(g => g.personId === "p-member"), false);
        assert.equal(fakeRepo.dump("rosters").some(r => r.personId === "p-member"), false);
    });

    test("delete-all refuses without an explicit confirmation", async () => {
        const res = await call("/api/admin/collections/people/delete-all", json({}, asAdmin));
        assert.equal(res.status, 400);
        assert.equal(fakeRepo.dump("people").length, 4, "nothing may have been deleted");
    });

    test("delete-all names an unknown collection rather than guessing", async () => {
        const res = await call("/api/admin/collections/nonsense/delete-all", json({ confirm: true }, asAdmin));
        assert.equal(res.status, 400);
    });

    test("importing people keeps an existing person's access code", async () => {
        // The Firebase version minted a new code for every imported row, which
        // silently killed every magic link already in circulation.
        const res = await call("/api/admin/import/people", json({
            rows: [{ firstName: "Mary", lastName: "Member", email: "", qualifies: "true" }],
        }, asAdmin));
        assert.equal(res.status, 200);

        const mary = fakeRepo.dump("people").find(p => p.id === "p-member");
        assert.equal(mary?.accessCode, MEMBER_CODE);
    });

    test("a diagnosis in an import is never stored", async () => {
        const res = await call("/api/admin/import/people", json({
            rows: [{ firstName: "New", lastName: "Person", condition: "Multiple Sclerosis" }],
        }, asAdmin));
        assert.equal(res.status, 200);

        const stored = JSON.stringify(fakeRepo.dump("people"));
        assert.equal(stored.includes("Sclerosis"), false, "the diagnosis must not be stored");
        assert.equal(stored.includes('"condition"'), false);
    });

    test("a condition column is refused, not quietly ignored", async () => {
        // Ignoring it would mark every row as not qualifying and reclassify the
        // whole file as `external` - a silent, wrong, and plausible-looking
        // result. The import has to say so.
        const res = await call("/api/admin/import/people", json({
            rows: [{ firstName: "New", lastName: "Person", condition: "Multiple Sclerosis" }],
        }, asAdmin));

        assert.ok(res.body.mismatchCount > 0, "it must count as a mismatch");
        assert.ok(
            (res.body.logs as string[]).some(l => l.includes("condition") && l.includes("qualifies")),
            "and name both the offending column and the replacement"
        );
    });

    test("a diagnosis never reaches the audit log either", async () => {
        await call("/api/admin/import/people", json({
            rows: [{ firstName: "New", lastName: "Person", condition: "Parkinsons" }],
        }, asAdmin));

        // Covers the warning above too: it must report the column without
        // quoting the value, because this log is retained.
        const logs = JSON.stringify(fakeRepo.dump("auditLogs"));
        assert.equal(logs.includes("Parkinsons"), false);
        assert.equal(logs.includes("Sclerosis"), false);
    });

    test("an import writes one audit record, not one per row", async () => {
        // Per-row audit writes doubled the write count, and the platform caps a
        // request at 45 seconds. At Infoodle scale that was the difference
        // between an import finishing and failing half done.
        const rows = Array.from({ length: 25 }, (_, i) => ({
            firstName: `Person${i}`, lastName: "Imported",
        }));
        const res = await call("/api/admin/import/people", json({ rows }, asAdmin));
        assert.equal(res.status, 200);
        assert.equal(res.body.successCount, 25);

        const audit = fakeRepo.dump("auditLogs");
        assert.equal(audit.length, 1);
        assert.equal(audit[0].rowCount, 25);
        assert.equal(audit[0].successCount, 25);
        assert.equal(audit[0].userId, "admin@mspc.org.nz");
    });

    test("every row of a larger import is written", async () => {
        // Guards the concurrent write path: a bug in the worker pool would show
        // up as a plausible-looking but short result.
        const rows = Array.from({ length: 60 }, (_, i) => ({
            firstName: `Bulk${i}`, lastName: "Person",
        }));
        await call("/api/admin/import/people", json({ rows }, asAdmin));

        const created = fakeRepo.dump("people").filter(p => p.lastName === "Person");
        assert.equal(created.length, 60);
        assert.equal(new Set(created.map(p => p.id)).size, 60, "ids must be distinct");
    });

    test("an import without an infoodleId leaves it absent, not invented", async () => {
        // infoodleId names a record in Infoodle. A fabricated one is
        // indistinguishable from a real one afterwards, and the Infoodle
        // attendance API takes an integer userId - a made-up value either fails
        // or addresses somebody else.
        await call("/api/admin/import/people", json({
            rows: [{ firstName: "No", lastName: "ExternalId" }],
        }, asAdmin));

        const created = fakeRepo.dump("people").find(p => p.lastName === "ExternalId");
        assert.equal(created?.infoodleId, undefined);
    });

    test("an import that supplies an infoodleId keeps it", async () => {
        await call("/api/admin/import/people", json({
            rows: [{ firstName: "Has", lastName: "ExternalId", infoodleId: " 114177 " }],
        }, asAdmin));

        const created = fakeRepo.dump("people").find(p => p.lastName === "ExternalId");
        assert.equal(created?.infoodleId, "114177", "trimmed, not padded");
    });

    test("a unique_id lands in its own field, not in infoodleId", async () => {
        // Infoodle issues two numbers per person. A CSV export gives the
        // profile unique_id; POST /groups/attendance takes the internal userId.
        // Both are integers, so nothing downstream could tell them apart - the
        // column is the only distinction, and it has to survive the import.
        await call("/api/admin/import/people", json({
            rows: [{ firstName: "Two", lastName: "Ids", infoodleUniqueId: " 779 " }],
        }, asAdmin));

        const created = fakeRepo.dump("people").find(p => p.lastName === "Ids");
        assert.equal(created?.infoodleUniqueId, "779", "trimmed, not padded");
        assert.equal(
            created?.infoodleId,
            undefined,
            "a unique_id must never populate the field attendance write-back reads"
        );
    });

    test("both id columns are kept, and kept apart", async () => {
        await call("/api/admin/import/people", json({
            rows: [{ firstName: "Both", lastName: "Ids", infoodleId: "114177", infoodleUniqueId: "779" }],
        }, asAdmin));

        const created = fakeRepo.dump("people").find(p => p.lastName === "Ids");
        assert.equal(created?.infoodleId, "114177");
        assert.equal(created?.infoodleUniqueId, "779");
    });

    test("a non-integer is refused in either id column, and named", async () => {
        const res = await call("/api/admin/import/people", json({
            rows: [{
                firstName: "Bad", lastName: "Ids",
                infoodleId: "8d8206dc-de44-4da9-ace1-354a7fa844d2",
                infoodleUniqueId: "not-a-number",
            }],
        }, asAdmin));

        const created = fakeRepo.dump("people").find(p => p.lastName === "Ids");
        assert.equal(created?.infoodleId, undefined);
        assert.equal(created?.infoodleUniqueId, undefined);

        const logs = (res.body.logs as string[]).join("\n");
        assert.ok(logs.includes("infoodleId"), "the message must say which column");
        assert.ok(logs.includes("infoodleUniqueId"));
    });

    test("generated events carry no infoodleId", async () => {
        // They were generated here from a group schedule; they do not exist in
        // Infoodle, and saying otherwise would make a local event look synced.
        await call("/api/admin/generate-events", json({}, asAdmin));

        const generated = fakeRepo.dump("events").filter(e => e.notes === "Auto-generated from group schedule");
        assert.ok(generated.every(e => e.infoodleId === undefined));
    });

    test("a person named twice in one file is written once, last wins", async () => {
        const res = await call("/api/admin/import/people", json({
            rows: [
                { firstName: "Dup", lastName: "Licate", email: "d@x.com", type: "staff" },
                { firstName: "Dup", lastName: "Licate", email: "d@x.com", type: "admin" },
            ],
        }, asAdmin));
        assert.equal(res.status, 200);

        const matches = fakeRepo.dump("people").filter(p => p.lastName === "Licate");
        assert.equal(matches.length, 1, "the same person must not be written twice");
        assert.equal(matches[0].type, "admin", "the later row wins, as it did sequentially");
    });
});

describe("health", () => {
    test("reports ok when the database answers", async () => {
        const res = await call("/api/health");
        assert.equal(res.status, 200);
        assert.equal(res.body.status, "ok");
    });
});
