import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as classify from "../src/server/classify.js";
import {
    asQualifies,
    groupRoleIndex,
    resolvePersonType,
    supportPersonIndex,
    validGroupRole,
} from "../src/server/classify.js";

describe("nothing here reads a diagnosis", () => {
    // There was a qualifiesFromText() that took "multiple sclerosis" and
    // answered true. Nothing was stored, but its existence is what made a
    // `condition` column in a CSV look supported. Removed on purpose, and
    // asserted so that a helpful reinstatement has to argue with a test.
    test("qualifiesFromText is gone and stays gone", () => {
        assert.equal("qualifiesFromText" in classify, false);
    });

    test("no export interprets diagnosis wording", () => {
        for (const [name, value] of Object.entries(classify)) {
            if (typeof value !== "function") continue;
            const source = String(value);
            for (const word of ["SCLEROSIS", "PARKINSON"]) {
                assert.equal(
                    source.toUpperCase().includes(word),
                    false,
                    `${name}() mentions ${word}; diagnosis vocabulary does not belong here`
                );
            }
        }
    });
});

describe("asQualifies", () => {
    test("passes a boolean through", () => {
        assert.equal(asQualifies(true), true);
        assert.equal(asQualifies(false), false);
    });

    test("accepts the string forms a CSV produces", () => {
        assert.equal(asQualifies("true"), true);
        assert.equal(asQualifies("Yes"), true);
        assert.equal(asQualifies("1"), true);
    });

    test("is false for anything else", () => {
        assert.equal(asQualifies("no"), false);
        assert.equal(asQualifies(""), false);
        assert.equal(asQualifies(undefined), false);
    });
});

describe("resolvePersonType", () => {
    const base = { currentType: "member", qualifies: false, isSupportPerson: false, groupRoles: [] as string[] };

    test("a qualifying condition always makes someone a member", () => {
        assert.equal(resolvePersonType({ ...base, currentType: "external", qualifies: true }), "member");
        assert.equal(resolvePersonType({ ...base, currentType: "support", qualifies: true }), "member");
    });

    test("a member with no qualifying condition becomes external", () => {
        assert.equal(resolvePersonType({ ...base, currentType: "member" }), "external");
    });

    test("an unrecognised type becomes external", () => {
        assert.equal(resolvePersonType({ ...base, currentType: "visitor" }), "external");
    });

    test("staff and admin are left alone", () => {
        assert.equal(resolvePersonType({ ...base, currentType: "staff" }), "staff");
        assert.equal(resolvePersonType({ ...base, currentType: "admin" }), "admin");
    });

    test("being somebody's support person wins over the type", () => {
        assert.equal(resolvePersonType({ ...base, currentType: "staff", isSupportPerson: true }), "support");
    });

    test("a leader role re-runs the choice", () => {
        assert.equal(resolvePersonType({ ...base, currentType: "staff", groupRoles: ["leader"] }), "external");
        assert.equal(
            resolvePersonType({ ...base, currentType: "staff", groupRoles: ["leader"], isSupportPerson: true }),
            "support"
        );
        assert.equal(
            resolvePersonType({ ...base, currentType: "external", qualifies: true, groupRoles: ["speaker"] }),
            "member"
        );
    });

    test("an ordinary member role does not trigger the leadership arm", () => {
        assert.equal(resolvePersonType({ ...base, currentType: "staff", groupRoles: ["member"] }), "staff");
    });
});

describe("supportPersonIndex", () => {
    const people = [
        { id: "p1", firstName: "Ann", lastName: "Smith" },
        { id: "p2", firstName: "Bob", lastName: "Jones", supportPersonId: "p1" },
        { id: "p3", firstName: "Cara", lastName: "Lee", supportPersonName: "Dan Ray" },
    ];

    test("matches an explicit link by id", () => {
        assert.equal(supportPersonIndex(people).has("p1", "Ann", "Smith"), true);
    });

    test("matches a written-down name when there is no link", () => {
        assert.equal(supportPersonIndex(people).has("p9", "Dan", "Ray"), true);
        assert.equal(supportPersonIndex(people).has("p9", "dan", " RAY "), true);
    });

    test("does not match somebody unrelated", () => {
        assert.equal(supportPersonIndex(people).has("p3", "Cara", "Lee"), false);
    });

    test("an empty name is never a match", () => {
        assert.equal(supportPersonIndex(people).has("", "", ""), false);
    });
});

describe("groupRoleIndex", () => {
    test("collects every role a person holds", () => {
        const index = groupRoleIndex([
            { personId: "p1", role: "Member" },
            { personId: "p1", role: "LEADER" },
            { personId: "p2", role: "speaker" },
        ]);
        assert.deepEqual(index.rolesFor("p1").sort(), ["leader", "member"]);
        assert.deepEqual(index.rolesFor("p2"), ["speaker"]);
        assert.deepEqual(index.rolesFor("nobody"), []);
    });

    test("ignores rows with no person", () => {
        assert.deepEqual(groupRoleIndex([{ personId: "", role: "leader" }]).rolesFor(""), []);
    });
});

describe("validGroupRole", () => {
    test("accepts the known roles", () => {
        assert.equal(validGroupRole("Leader"), "leader");
        assert.equal(validGroupRole("support"), "support");
    });

    test("falls back to member for anything else", () => {
        assert.equal(validGroupRole("wizard"), "member");
        assert.equal(validGroupRole(undefined), "member");
        assert.equal(validGroupRole(""), "member");
    });
});
