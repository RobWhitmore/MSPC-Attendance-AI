import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { adminEmailDomains, getPrincipal, publicPerson, publicPeople, serverError, isConnRefused } from "../src/server/auth.js";

/** A Request with just enough of one to read a header. */
function requestWith(headers: Record<string, string>): Request {
    return {
        header: (name: string) => headers[name.toLowerCase()],
    } as unknown as Request;
}

function swaPrincipalHeader(payload: Record<string, unknown>): Record<string, string> {
    return {
        "x-ms-client-principal": Buffer.from(JSON.stringify(payload)).toString("base64"),
    };
}

describe("adminEmailDomains", () => {
    beforeEach(() => {
        delete process.env.ADMIN_EMAIL_DOMAINS;
    });

    test("splits and normalises a list", () => {
        process.env.ADMIN_EMAIL_DOMAINS = "MSPC.org.nz, example.com";
        assert.deepEqual(adminEmailDomains(), ["mspc.org.nz", "example.com"]);
    });

    test("drops blank entries left by a trailing comma", () => {
        // A blank entry becomes endsWith("@"), which is true of every address
        // ever issued - so this must produce two domains, not three.
        process.env.ADMIN_EMAIL_DOMAINS = "mspc.org.nz,example.com,";
        assert.deepEqual(adminEmailDomains(), ["mspc.org.nz", "example.com"]);
    });

    test("tolerates a leading @", () => {
        process.env.ADMIN_EMAIL_DOMAINS = "@mspc.org.nz";
        assert.deepEqual(adminEmailDomains(), ["mspc.org.nz"]);
    });

    test("is empty when unset, so the caller can deny", () => {
        assert.deepEqual(adminEmailDomains(), []);
    });
});

describe("getPrincipal", () => {
    beforeEach(() => {
        process.env.AUTH_MODE = "swa";
    });

    test("reads a Static Web Apps principal", () => {
        const req = requestWith(
            swaPrincipalHeader({
                identityProvider: "aad",
                userId: "abc123",
                userDetails: "Person@MSPC.org.nz",
                userRoles: ["authenticated"],
            })
        );
        assert.deepEqual(getPrincipal(req), {
            email: "person@mspc.org.nz",
            identityProvider: "aad",
            userId: "abc123",
        });
    });

    test("returns null when there is no header at all", () => {
        assert.equal(getPrincipal(requestWith({})), null);
    });

    test("fails closed when AUTH_MODE names another platform", () => {
        // App Service Easy Auth injects the same header name with a different
        // payload. A parser that accepted either would fail OPEN on the platform
        // it was not written for.
        process.env.AUTH_MODE = "easyauth";
        const req = requestWith(
            swaPrincipalHeader({ identityProvider: "aad", userDetails: "person@mspc.org.nz" })
        );
        assert.equal(getPrincipal(req), null);
    });

    test("fails closed when AUTH_MODE is unset", () => {
        delete process.env.AUTH_MODE;
        const req = requestWith(
            swaPrincipalHeader({ identityProvider: "aad", userDetails: "person@mspc.org.nz" })
        );
        assert.equal(getPrincipal(req), null);
    });

    test("returns null for a header that is not base64 JSON", () => {
        assert.equal(getPrincipal(requestWith({ "x-ms-client-principal": "not-base64-json" })), null);
    });

    test("translates a B2B guest UPN back to an address", () => {
        // Entra issues an invited guest a principal name inside the tenant.
        // Untranslated it matches no staff domain, and every record they touch
        // is attributed to that string rather than to a person.
        const req = requestWith(
            swaPrincipalHeader({
                identityProvider: "aad",
                userId: "guest1",
                userDetails: "someone_example.org#EXT#@mspc.onmicrosoft.com",
            })
        );
        assert.equal(getPrincipal(req)?.email, "someone@example.org");
    });

    test("splits a guest UPN at the last underscore", () => {
        // A local part may contain underscores; a domain may not, so the last
        // one before #EXT# is unambiguously the separator.
        const req = requestWith(
            swaPrincipalHeader({
                identityProvider: "aad",
                userId: "guest2",
                userDetails: "first_last_example.org#EXT#@mspc.onmicrosoft.com",
            })
        );
        assert.equal(getPrincipal(req)?.email, "first_last@example.org");
    });

    test("yields an empty email when no email claim arrived", () => {
        const req = requestWith(swaPrincipalHeader({ identityProvider: "aad", userId: "x" }));
        assert.equal(getPrincipal(req)?.email, "");
    });
});

describe("publicPerson", () => {
    const person = {
        id: "p1",
        firstName: "A",
        lastName: "B",
        accessCode: "DEADBEEF0000",
        condition: "MS",
    };

    test("removes the access code", () => {
        const result = publicPerson(person);
        assert.equal("accessCode" in result, false);
        assert.equal(result.firstName, "A");
    });

    test("leaves the original untouched", () => {
        publicPerson(person);
        assert.equal(person.accessCode, "DEADBEEF0000");
    });

    test("removes the access code from every person in a list", () => {
        const list = publicPeople([person, { ...person, id: "p2" }]);
        assert.equal(list.length, 2);
        assert.equal(JSON.stringify(list).includes("accessCode"), false);
    });
});

describe("serverError", () => {
    test("logs a single clear line when Cosmos connection is refused", () => {
        process.env.COSMOS_ENDPOINT = "https://localhost:8081/";
        const logged: unknown[][] = [];
        const origError = console.error;
        console.error = (...args: unknown[]) => { logged.push(args); };

        let statusSent = 0;
        let bodySent: unknown = null;
        const res = {
            status(code: number) {
                statusSent = code;
                return this;
            },
            json(payload: unknown) {
                bodySent = payload;
                return this;
            },
        } as unknown as Response;

        try {
            const err = new Error("request to https://localhost:8081/ failed, reason: connect ECONNREFUSED 127.0.0.1:8081");
            assert.equal(isConnRefused(err), true);
            serverError(res, "admin/me", err);
        } finally {
            console.error = origError;
        }

        assert.equal(statusSent, 500);
        assert.deepEqual(bodySent, { error: "Internal Server Error" });
        assert.equal(logged.length, 1);
        assert.deepEqual(logged[0], [
            "admin/me: Cannot reach Cosmos at https://localhost:8081/ – is the emulator running?",
        ]);
    });
});
