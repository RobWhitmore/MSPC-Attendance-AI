/**
 * Post-deploy smoke tests.
 *
 *   npm run smoke -- https://app.mspc.org.nz
 *
 * A deploy that returns 200 is not a deploy that works. The assertions that
 * earn their place here are the ones that fail if participant data is public,
 * so most of this file is checking that things are REFUSED.
 */

const baseUrl = (process.argv[2] || process.env.SMOKE_URL || "").replace(/\/$/, "");

if (!baseUrl) {
    console.error("Usage: npm run smoke -- https://<host>");
    process.exit(1);
}

let failures = 0;
let passes = 0;

function check(name: string, ok: boolean, detail = ""): void {
    if (ok) {
        passes++;
        console.log(`  PASS  ${name}`);
    } else {
        failures++;
        console.error(`  FAIL  ${name}${detail ? `\n          ${detail}` : ""}`);
    }
}

async function get(path: string, headers: Record<string, string> = {}) {
    const res = await fetch(`${baseUrl}${path}`, { headers, redirect: "manual" });
    const text = await res.text();
    return { status: res.status, text };
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        redirect: "manual",
    });
    const text = await res.text();
    return { status: res.status, text };
}

/** Anything that is not a 2xx. A redirect to a login page counts as refused. */
function refused(status: number): boolean {
    return status !== 200 && status !== 201 && status !== 204;
}

async function main() {
    console.log(`\nSmoke testing ${baseUrl}\n`);

    // --- it is alive --------------------------------------------------------
    const health = await get("/api/health");
    check(
        "GET /api/health returns ok",
        health.status === 200 && health.text.includes('"status":"ok"'),
        `got ${health.status}: ${health.text.slice(0, 200)}`
    );

    const root = await get("/");
    check("GET / serves the client", root.status === 200, `got ${root.status}`);

    // --- the API is NOT open ------------------------------------------------
    // This is the assertion that matters. The client is served to everybody,
    // because magic links have to reach it, so the API is the only thing
    // enforcing anything.

    const adminData = await get("/api/admin/data/People");
    check(
        "GET /api/admin/data/People is refused without a principal",
        refused(adminData.status),
        `got ${adminData.status} - ADMIN DATA IS PUBLIC: ${adminData.text.slice(0, 200)}`
    );

    const adminBackup = await get("/api/admin/backup");
    check(
        "GET /api/admin/backup is refused without a principal",
        refused(adminBackup.status),
        `got ${adminBackup.status} - THE WHOLE DATABASE IS PUBLIC`
    );

    const portalNoCode = await get("/api/portal/data");
    check(
        "GET /api/portal/data is refused without an access code",
        refused(portalNoCode.status),
        `got ${portalNoCode.status}`
    );

    const leaderNoCode = await get("/api/leader/data");
    check(
        "GET /api/leader/data is refused without an access code",
        refused(leaderNoCode.status),
        `got ${leaderNoCode.status}`
    );

    const portalBadCode = await get("/api/portal/data", { "x-access-code": "NOT-A-REAL-CODE" });
    check(
        "GET /api/portal/data is refused with an unknown access code",
        refused(portalBadCode.status),
        `got ${portalBadCode.status}`
    );

    const writeNoCode = await post("/api/portal/action", {
        eventId: "any",
        targetPersonId: "any",
        action: "rsvp",
        value: "booked",
    });
    check(
        "POST /api/portal/action is refused without an access code",
        refused(writeNoCode.status),
        `got ${writeNoCode.status} - ANYONE CAN WRITE ROSTERS`
    );

    const adminWrite = await post("/api/admin/action", {
        eventId: "any",
        targetPersonId: "any",
        action: "attendance",
        value: "present",
    });
    check(
        "POST /api/admin/action is refused without a principal",
        refused(adminWrite.status),
        `got ${adminWrite.status} - ANYONE CAN WRITE AS AN ADMIN`
    );

    // --- credentials do not leak -------------------------------------------
    const anonymousBodies = [
        health.text,
        adminData.text,
        adminBackup.text,
        portalNoCode.text,
        leaderNoCode.text,
        portalBadCode.text,
    ];
    check(
        "no anonymous response mentions accessCode",
        !anonymousBodies.some(b => b.includes("accessCode")),
        "an access code appeared in a response reachable without credentials"
    );

    // --- the sign-in route exists ------------------------------------------
    const login = await get("/.auth/login/aad");
    check(
        "/.auth/login/aad is wired up",
        login.status === 302 || login.status === 200,
        `got ${login.status} - staff cannot sign in`
    );

    console.log(`\n${passes} passed, ${failures} failed\n`);
    if (failures > 0) process.exit(1);
}

main().catch(err => {
    console.error("\nSmoke tests could not run:", err);
    process.exit(1);
});
