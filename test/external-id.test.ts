import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    acceptInfoodleId,
    externalId,
    hasInfoodleIdShape,
    INFOODLE_ID_FIELDS,
    looksFabricated,
    rejectionMessage,
} from "../src/server/external-id.js";

describe("externalId", () => {
    test("trims a supplied value", () => {
        assert.equal(externalId("  114177 "), "114177");
    });

    test("is undefined when there is nothing, never a substitute", () => {
        assert.equal(externalId(""), undefined);
        assert.equal(externalId("   "), undefined);
        assert.equal(externalId(undefined), undefined);
        assert.equal(externalId(null), undefined);
    });
});

describe("hasInfoodleIdShape", () => {
    test("accepts integers, the shape Infoodle issues", () => {
        assert.equal(hasInfoodleIdShape("3"), true);
        assert.equal(hasInfoodleIdShape("114177"), true);
        assert.equal(hasInfoodleIdShape(" 42 "), true);
        assert.equal(hasInfoodleIdShape(42), true);
    });

    test("cannot tell a genuine id from a plausible one", () => {
        // "3" is the right shape and may well belong to somebody else entirely.
        // Shape is all this checks; provenance is not knowable from the value.
        assert.equal(hasInfoodleIdShape("3"), true);
    });

    test("rejects everything else", () => {
        assert.equal(hasInfoodleIdShape(""), false);
        assert.equal(hasInfoodleIdShape(undefined), false);
        assert.equal(hasInfoodleIdShape("abc"), false);
        assert.equal(hasInfoodleIdShape("12a"), false);
    });
});

describe("acceptInfoodleId", () => {
    test("accepts an integer, trimmed", () => {
        assert.deepEqual(acceptInfoodleId(" 114177 "), { value: "114177" });
    });

    test("absent is neither accepted nor rejected", () => {
        assert.deepEqual(acceptInfoodleId(""), {});
        assert.deepEqual(acceptInfoodleId(undefined), {});
        assert.deepEqual(acceptInfoodleId("   "), {});
    });

    test("reports the refused value instead of substituting one", () => {
        // Never `{ value: something }` on a refusal. The whole point of the
        // field is that absent means "we do not know it".
        assert.deepEqual(acceptInfoodleId("8d8206dc-de44"), { rejected: "8d8206dc-de44" });
        assert.equal(acceptInfoodleId("8d8206dc-de44").value, undefined);
    });

    test("cannot distinguish a userId from a unique_id", () => {
        // Both are integers. Only the column tells them apart, which is why
        // they are stored in separate fields rather than validated apart.
        assert.deepEqual(acceptInfoodleId("779"), acceptInfoodleId("779"));
        assert.equal(acceptInfoodleId("779").value, "779");
    });
});

describe("rejectionMessage", () => {
    test("names the field, because the field is the only distinction", () => {
        for (const field of INFOODLE_ID_FIELDS) {
            const message = rejectionMessage(field, "nonsense");
            assert.ok(message.includes(field), `should name ${field}`);
            assert.ok(message.includes("nonsense"));
        }
    });

    test("covers both id fields", () => {
        assert.deepEqual([...INFOODLE_ID_FIELDS], ["infoodleId", "infoodleUniqueId"]);
    });
});

describe("looksFabricated", () => {
    // The first version of this checked for 32-character hex, because that is
    // what newId() makes - and missed every one of the 40 event ids the old
    // client had generated with uuidv4(). Both forms must be caught.
    test("catches a uuid with dashes", () => {
        assert.equal(looksFabricated("8d8206dc-de44-4da9-ace1-354a7fa844d2"), true);
    });

    test("catches a 32-character hex id", () => {
        assert.equal(looksFabricated("0f8b2c1d4e6a7b9c0d1e2f3a4b5c6d7e"), true);
    });

    test("leaves a real integer id alone", () => {
        assert.equal(looksFabricated("106"), false);
        assert.equal(looksFabricated("3"), false);
    });

    test("absent is not fabricated", () => {
        assert.equal(looksFabricated(""), false);
        assert.equal(looksFabricated(undefined), false);
    });
});
