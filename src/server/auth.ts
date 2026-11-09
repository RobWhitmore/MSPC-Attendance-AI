import type { Request, Response } from "express";
import { randomBytes } from "crypto";
import { byField, byFields, getById, type Doc } from "./repo.js";

/**
 * Three populations, three mechanisms - see ARCHITECTURE.md.
 *
 *   staff/admin      Entra via Static Web Apps, then an allowlist
 *   member/leader    an access code in the x-access-code header
 *   everyone else    nothing; there is no anonymous surface
 */

export interface VerifiedPerson {
    id: string;
    data: Doc;
}

export interface Principal {
    /** Lowercased email address, or "" when the token carried none. */
    email: string;
    identityProvider: string;
    userId: string;
}

const LEADER_ROLES = ["leader", "staff", "admin"];

// ---------------------------------------------------------------------------
// Access codes (members and leaders)
// ---------------------------------------------------------------------------

/**
 * Read the caller's access code from the x-access-code header, or the request
 * body for the routes that post it.
 *
 * The query string is deliberately NOT accepted. A code is a bearer credential;
 * query strings reach platform access logs and Application Insights, and the
 * Firebase version's `?accessCode=` fallback put them there.
 */
export function getAccessCode(req: Request): string | undefined {
    const header = req.header("x-access-code");
    if (header) return header;
    const fromBody = (req.body as Record<string, unknown> | undefined)?.accessCode;
    if (typeof fromBody === "string") return fromBody;
    return undefined;
}

/** Look up a person by their access code. Null when the code is missing or unknown. */
export async function verifyAccessCode(accessCode: unknown): Promise<VerifiedPerson | null> {
    if (!accessCode || typeof accessCode !== "string") return null;
    const rows = await byField("people", "accessCode", accessCode);
    if (rows.length === 0) return null;
    return { id: String(rows[0].id), data: rows[0] };
}

/** True for people whose person-type is staff or admin. */
export function isStaffOrAdmin(caller: VerifiedPerson): boolean {
    const t = String(caller.data.type || "").toLowerCase();
    return t === "staff" || t === "admin";
}

/** True if the caller is staff/admin, or a leader of the given group (incl. legacy Airtable fallback). */
export async function isLeaderOfGroup(
    caller: VerifiedPerson,
    groupId: string | undefined
): Promise<boolean> {
    if (isStaffOrAdmin(caller)) return true;
    if (!groupId) return false;

    const memberships = await byFields("groupMembers", {
        personId: caller.id,
        groupId,
    });
    if (memberships.some(m => LEADER_ROLES.includes(String(m.role || "").toLowerCase()))) {
        return true;
    }

    // Fallback to legacy Airtable structure where group membership lived on the person doc.
    const pData = caller.data;
    const pRole = String(pData.type || pData.role || "").toLowerCase();
    if (LEADER_ROLES.includes(pRole)) {
        const groups = Array.isArray(pData.Group) ? pData.Group
            : Array.isArray(pData.group) ? pData.group
            : typeof pData.groupId === "string" ? [pData.groupId] : [];
        if (groups.includes(groupId)) return true;
    }
    return false;
}

/**
 * A cryptographically-random access code (48 bits, uppercase hex).
 *
 * The Firebase version built these in the browser from
 * `uuidv4() + Math.random()`. `Math.random` is not a CSPRNG and these are
 * bearer tokens that live in URLs, so generation is server-side only now.
 */
export function generateAccessCode(prefix = ""): string {
    return prefix + randomBytes(6).toString("hex").toUpperCase();
}

// ---------------------------------------------------------------------------
// Staff identity (Entra, via Static Web Apps)
// ---------------------------------------------------------------------------

/**
 * App Service Easy Auth and Static Web Apps both inject `x-ms-client-principal`
 * and the payloads are NOT the same. AUTH_MODE selects the parser explicitly so
 * that naming the wrong platform fails closed; a parser that accepted either
 * shape would fail *open* on the platform it was not written for.
 */
export function getPrincipal(req: Request): Principal | null {
    const raw = req.header("x-ms-client-principal");
    if (!raw) return null;

    let decoded: any;
    try {
        decoded = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    } catch {
        console.warn("auth: x-ms-client-principal was not base64 JSON");
        return null;
    }

    const mode = (process.env.AUTH_MODE || "").toLowerCase();
    if (mode !== "swa") {
        console.error(`auth: AUTH_MODE is "${mode || "unset"}", expected "swa" - refusing to parse a principal`);
        return null;
    }

    // Static Web Apps: { identityProvider, userId, userDetails, userRoles, claims? }
    const identityProvider = String(decoded.identityProvider || "");
    const userId = String(decoded.userId || "");
    const email = normaliseEntraName(String(decoded.userDetails || ""));

    if (!email) {
        // Log which claims arrived, never their values - the type is a schema
        // URI, the value is the person.
        const claimTypes = Array.isArray(decoded.claims)
            ? decoded.claims.map((c: any) => String(c?.typ || "")).join(",")
            : "(none)";
        console.warn(`auth: principal carried no userDetails; claim types present: ${claimTypes}`);
    }

    return { email, identityProvider, userId };
}

/**
 * Entra issues an invited guest a principal name inside the tenant:
 *
 *     rob_example.org#EXT#@mspc.onmicrosoft.com
 *
 * which matches no staff domain. Translate it back: the `@` became an
 * underscore, and a domain cannot contain one, so the last underscore before
 * `#EXT#` is unambiguously the separator.
 */
function normaliseEntraName(userDetails: string): string {
    const value = userDetails.trim().toLowerCase();
    if (!value) return "";
    const extIndex = value.indexOf("#ext#");
    if (extIndex === -1) return value;

    const local = value.slice(0, extIndex);
    const split = local.lastIndexOf("_");
    if (split === -1) return value;
    return `${local.slice(0, split)}@${local.slice(split + 1)}`;
}

/**
 * Domains whose addresses may hold an admin record.
 *
 * Blank entries are dropped: a trailing comma otherwise leaves an empty string,
 * and `endsWith("@")` is true of every address ever issued.
 */
export function adminEmailDomains(): string[] {
    return (process.env.ADMIN_EMAIL_DOMAINS || "")
        .split(",")
        .map(d => d.trim().toLowerCase().replace(/^@/, ""))
        .filter(Boolean);
}

/**
 * Verify the caller is an authenticated admin.
 *
 * Authentication is not authorisation. Entra `/common` will authenticate any
 * identity Microsoft can find, anywhere in the world. Two independent checks
 * stand between that and the data, and both deny when their configuration is
 * empty.
 */
export async function verifyAdmin(req: Request): Promise<Principal | null> {
    const principal = getPrincipal(req);
    if (!principal) {
        console.warn("auth: admin route reached with no principal (not signed in)");
        return null;
    }
    if (!principal.email) {
        console.warn("auth: admin route reached with a principal carrying no email claim");
        return null;
    }

    const domains = adminEmailDomains();
    if (domains.length === 0) {
        console.error("auth: ADMIN_EMAIL_DOMAINS is empty - denying all admin access");
        return null;
    }
    const domain = principal.email.split("@")[1] || "";
    if (!domains.includes(domain)) {
        console.warn(`auth: rejected admin sign-in from non-allowlisted domain "${domain}"`);
        return null;
    }

    const record = await getById("admins", principal.email);
    if (!record) {
        console.warn(`auth: "${domain}" address authenticated but has no admins record`);
        return null;
    }
    return principal;
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

/**
 * The only person shape that goes over the wire.
 *
 * `accessCode` is a credential. The Firebase version spread whole person
 * documents into `/api/leader/data` and `/api/portal/data`, so one leader's
 * link returned the access code of everyone in their groups. Routing every
 * person through here is what stops that regressing per-route.
 */
export function publicPerson(person: Doc): Doc {
    const { accessCode, ...rest } = person;
    void accessCode;
    return rest;
}

export function publicPeople(people: Doc[]): Doc[] {
    return people.map(publicPerson);
}

/**
 * A group member as their leader sees them: what the roster screen draws, and
 * nothing it does not.
 *
 * An allowlist, not `publicPerson` with more fields removed - a field added to
 * person documents later must not reach volunteer leaders by default. Contact
 * details are held by staff; `qualifies` and the Infoodle ids are never needed
 * to run a session.
 */
const LEADER_VIEW_FIELDS = ["id", "firstName", "lastName", "type", "supportPersonId"];

export function leaderViewOfPerson(person: Doc): Doc {
    const view: Doc = {};
    for (const field of LEADER_VIEW_FIELDS) {
        if (person[field] !== undefined) view[field] = person[field];
    }
    return view;
}

export function isConnRefused(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const e = err as Record<string, any>;
    return (
        e.code === "ECONNREFUSED" ||
        e.cause?.code === "ECONNREFUSED" ||
        String(e.message ?? "").includes("ECONNREFUSED")
    );
}

/** Send a 500 without leaking internals to the client; log the full error server-side. */
export function serverError(res: Response, context: string, err: unknown): void {
    if (isConnRefused(err)) {
        const endpoint = process.env.COSMOS_ENDPOINT || "(COSMOS_ENDPOINT unset)";
        console.error(`${context}: Cannot reach Cosmos at ${endpoint} – is the emulator running?`);
    } else {
        console.error(`${context}:`, err);
    }
    res.status(500).json({ error: "Internal Server Error" });
}
