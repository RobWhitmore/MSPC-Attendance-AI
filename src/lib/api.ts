/**
 * The client's only route to the server.
 *
 * There is no database SDK in the browser any more. Cosmos has no equivalent of
 * Firestore security rules, so nothing here holds a credential that reaches the
 * data directly.
 */

export class ApiError extends Error {
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message);
        this.name = "ApiError";
    }
}

const LOGIN_URL = "/.auth/login/aad";

/**
 * A signed-in principal that the API then refuses would otherwise bounce
 * between the login page and the app forever. One redirect per tab, re-armed
 * whenever a request succeeds - a loop is much harder to report than an error.
 */
let redirectArmed = true;

function redirectToLogin(): void {
    if (!redirectArmed) return;
    redirectArmed = false;
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.assign(`${LOGIN_URL}?post_login_redirect_uri=${returnTo}`);
}

/**
 * Pull the server's own words out of a failure.
 *
 * The API answers `{ error: "<sentence>" }`. A helper that read only `message`
 * would replace every one of those sentences with a generic string, which is
 * how a specific, actionable server error becomes "something went wrong".
 */
async function describeFailure(res: Response): Promise<string> {
    try {
        const body = await res.json();
        if (typeof body?.error === "string" && body.error) return body.error;
        if (typeof body?.message === "string" && body.message) return body.message;
    } catch {
        // Not JSON - fall through to the status line.
    }
    return `${res.status} ${res.statusText}`.trim();
}

export interface ApiOptions extends RequestInit {
    /** Suppress the sign-in redirect on 401 and let the caller handle it. */
    noRedirect?: boolean;
    /** Access code for member and leader routes. */
    accessCode?: string;
}

export async function api<T = any>(path: string, options: ApiOptions = {}): Promise<T> {
    const { noRedirect, accessCode, headers, body, ...rest } = options;

    const res = await fetch(path, {
        ...rest,
        headers: {
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...(accessCode ? { "x-access-code": accessCode } : {}),
            ...headers,
        },
        body,
    });

    if (res.status === 401 && !noRedirect) {
        redirectToLogin();
        throw new ApiError("Not signed in.", 401);
    }

    if (!res.ok) {
        throw new ApiError(await describeFailure(res), res.status);
    }

    redirectArmed = true;

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
}

export function apiJson<T = any>(path: string, method: string, payload: unknown, options: ApiOptions = {}) {
    return api<T>(path, { ...options, method, body: JSON.stringify(payload) });
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export interface ClientPrincipal {
    identityProvider: string;
    userId: string;
    userDetails: string;
    userRoles: string[];
}

export interface AdminIdentity {
    signedIn: boolean;
    isAdmin: boolean;
    email?: string;
    role?: string;
    reason?: string;
}

/**
 * Ask Static Web Apps who is signed in. Always anonymous and always available,
 * so it can distinguish "not signed in" from "signed in but not an admin"
 * without a 401 having to stand for both.
 */
export async function getClientPrincipal(): Promise<ClientPrincipal | null> {
    try {
        const res = await fetch("/.auth/me");
        if (!res.ok) return null;
        const body = await res.json();
        return body?.clientPrincipal ?? null;
    } catch {
        return null;
    }
}

/** Ask the API whether this principal is an admin, and if not, why not. */
export async function getAdminIdentity(): Promise<AdminIdentity> {
    try {
        return await api<AdminIdentity>("/api/admin/me", { noRedirect: true });
    } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
            return { signedIn: false, isAdmin: false, reason: "no-principal" };
        }
        throw err;
    }
}

export function signIn(): void {
    window.location.assign(LOGIN_URL);
}

export function signOut(): void {
    window.location.assign("/.auth/logout");
}

// ---------------------------------------------------------------------------
// Access-code sign-in for the member and leader portals
// ---------------------------------------------------------------------------

export async function authenticateMagicLink(accessCode: string) {
    return apiJson<{ success: boolean; personId: string; role: string }>(
        "/api/link-session",
        "POST",
        { accessCode },
        { noRedirect: true }
    );
}
