/**
 * Person-type classification.
 *
 * The Firebase version carried four copies of these rules: `reclassifyPersonIfNeeded`,
 * the `people` branch of the CSV importer, the `groupMembers` branch of the same
 * importer, and `admin/import-group-members` on the server. They had already
 * drifted in small ways. One copy, server-side, is the point.
 */

const SUPPORTED_TYPES = ["staff", "admin", "support", "external"];
const LEADERSHIP_ROLES = ["speaker", "leader"];

/*
  There is deliberately no function here that reads a diagnosis.

  The app used to store the condition itself - "MS" or "PD" against a named
  person - and then, briefly, to read that text on import and reduce it to a
  boolean. Both are gone: nothing in this codebase interprets a diagnosis, so
  no import path can be talked into carrying one.

  MS and PD are still distinguished. They are carried by `groupTypes.shortValue`
  and reached through group membership, which is where the allocation actually
  lives - see INFOODLE-CSV.md.
*/

/** Read the stored flag, tolerating the string forms a CSV or an old record may carry. */
export function asQualifies(value: unknown): boolean {
    if (typeof value === "boolean") return value;
    const text = String(value ?? "").toLowerCase().trim();
    return text === "true" || text === "yes" || text === "1" || text === "qualifying";
}

export interface ClassifyInput {
    /** The person's existing type, if any. */
    currentType?: unknown;
    /** Whether they hold a qualifying condition. Not which one. */
    qualifies: boolean;
    /** True when somebody names this person as their support person. */
    isSupportPerson: boolean;
    /** Every group role this person holds, including any being added right now. */
    groupRoles: readonly string[];
}

/**
 * Resolve a person's type.
 *
 *   a qualifying condition always wins             -> member
 *   otherwise "member" without one                 -> external
 *   anything unrecognised                          -> external
 *   being somebody's support person                -> support
 *   holding a speaker or leader role re-runs the same three-way choice
 */
export function resolvePersonType(input: ClassifyInput): string {
    const { qualifies, isSupportPerson, groupRoles } = input;
    const currentType = String(input.currentType || "member").toLowerCase().trim();

    let resolved = currentType;
    if (qualifies) {
        resolved = "member";
    } else {
        if (resolved === "member") resolved = "external";
        if (!SUPPORTED_TYPES.includes(resolved)) resolved = "external";
        if (isSupportPerson) resolved = "support";
    }

    const hasLeadership = groupRoles.some(r =>
        LEADERSHIP_ROLES.includes(String(r || "").toLowerCase().trim())
    );
    if (hasLeadership) {
        if (qualifies) return "member";
        return isSupportPerson ? "support" : "external";
    }

    return resolved;
}

/**
 * Who counts as a support person, derived from the whole people set.
 * Matched by id when the link is explicit, and by name when it is only written down.
 */
export function supportPersonIndex(people: readonly Record<string, any>[]) {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const p of people) {
        if (p.supportPersonId) ids.add(String(p.supportPersonId));
        if (p.supportPersonName) names.add(normaliseName(p.supportPersonName));
    }
    return {
        ids,
        names,
        has(personId: string, firstName: unknown, lastName: unknown): boolean {
            if (personId && ids.has(personId)) return true;
            const full = normaliseName(`${String(firstName ?? "")} ${String(lastName ?? "")}`);
            return full !== "" && names.has(full);
        },
    };
}

/**
 * Fold a name to its comparison form.
 *
 * Internal whitespace is collapsed, not just trimmed: a padded CSV field turns
 * `"Dan" + " Ray "` into `"Dan  Ray"`, which never matches the `"Dan Ray"`
 * written on somebody's record.
 */
export function normaliseName(value: unknown): string {
    return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Group roles held per person, for the leadership arm of the rules. */
export function groupRoleIndex(groupMembers: readonly Record<string, any>[]) {
    const byPerson = new Map<string, string[]>();
    for (const gm of groupMembers) {
        const personId = String(gm.personId || "").trim();
        if (!personId) continue;
        const role = String(gm.role || "member").toLowerCase().trim();
        byPerson.set(personId, [...(byPerson.get(personId) || []), role]);
    }
    return {
        rolesFor: (personId: string): string[] => byPerson.get(personId) || [],
    };
}

/** Valid roles for a group membership row; anything else becomes `member`. */
export function validGroupRole(raw: unknown): string {
    const role = String(raw ?? "").toLowerCase().trim();
    return ["member", "leader", "speaker", "staff", "support"].includes(role) ? role : "member";
}
