/**
 * Identifiers that belong to another system.
 *
 * INFOODLE ISSUES TWO DIFFERENT NUMBERS FOR A PERSON, and they are not
 * interchangeable:
 *
 *   infoodleId        the internal `userId`. Returned by groups/members and
 *                     groups/membersforevent. This is what
 *                     POST /groups/attendance takes.
 *
 *   infoodleUniqueId  the profile `unique_id`, the one visible on a profile
 *                     page. Returned by people/search, people/directorysearch
 *                     and people/poll_new, and the only one a CSV export gives.
 *
 * The spec is explicit about the split, on POST /group/memberships/{id}/{groupid}:
 * "Identify the contact by their internal user id. If you only have a unique_id,
 * use /group/memberships/uniqueid/{uniqueid}/{groupid} instead."
 *
 * Both are integers, so no validator can tell them apart - only the column they
 * arrived in can. That is exactly why they get separate fields. Putting a
 * `unique_id` in `infoodleId` would store a value that passes every check here
 * and then posts attendance against whichever person happens to hold that
 * number as a `userId`.
 *
 * `infoodleId` names a record in Infoodle. We do not get to invent one.
 *
 * The Firebase version filled the field in whenever a CSV omitted it, and set
 * it to a fresh random id for every auto-generated event:
 *
 *     infoodleId: str(row.infoodleId) || newId()
 *     infoodleId: newId()
 *
 * That produces a 32-character hex string in a field whose real values are
 * Infoodle integers, and nothing distinguishes the two afterwards. It is
 * harmless while the only consumer is a CSV a human reconciles by hand, and it
 * stops being harmless the moment anything calls the Infoodle API with it:
 * `POST /apiv2/groups/attendance/...` takes an integer `userId`, so a
 * fabricated value either fails the request or, given a numeric-looking one,
 * addresses somebody else's record.
 *
 * Absent is the honest representation of "we do not know it".
 */

/**
 * Normalise an external id from an import row.
 *
 * Returns the trimmed value, or `undefined` when there isn't one - never a
 * substitute. Callers should omit the field rather than store a placeholder.
 */
export function externalId(raw: unknown): string | undefined {
    const value = String(raw ?? "").trim();
    return value === "" ? undefined : value;
}

/**
 * True when a value is the right SHAPE for an Infoodle id - an integer. The API
 * spec types `userId`, `groupid` and `eventid` that way (`userId: 114177`).
 *
 * Shape is not provenance, and this cannot tell you the id is correct.
 *
 * That distinction is the dangerous one. A fabricated uuid fails loudly at the
 * API, because it is not an integer. A fabricated *integer* - `3`, say, typed
 * into test data - passes every check here and then silently addresses a real
 * but entirely unrelated person in Infoodle. The wrong-shaped ids are the safe
 * ones; the plausible ones are not.
 *
 * Stated as "is it usable" rather than "does it look invented" on purpose. The
 * first version of this tested for a 32-character hex string, because that is
 * what `newId()` produces - and missed all 40 fabricated event ids, which the
 * old client had generated with `uuidv4()`, dashes and all. Enumerating the
 * ways a value can be wrong is a losing game; there is one way to be the right
 * shape, and no way at all to check it means anything.
 */
export function hasInfoodleIdShape(value: unknown): boolean {
    return /^\d+$/.test(String(value ?? "").trim());
}

/**
 * True for a value that is present but cannot be an Infoodle id at all.
 *
 * Catches only the obviously-wrong ones. A plausible-looking id from a system
 * that never talked to Infoodle is indistinguishable from a genuine one here -
 * see `hasInfoodleIdShape`.
 */
export function looksFabricated(value: unknown): boolean {
    const text = String(value ?? "").trim();
    return text !== "" && !hasInfoodleIdShape(text);
}

/** The person fields that hold an Infoodle identifier. */
export const INFOODLE_ID_FIELDS = ["infoodleId", "infoodleUniqueId"] as const;

export type InfoodleIdField = (typeof INFOODLE_ID_FIELDS)[number];

/**
 * Deliberately two optional fields rather than a discriminated union: this
 * project does not compile with `strict`, so narrowing on an `ok` discriminant
 * does not apply and every caller would need a cast.
 */
export interface AcceptedId {
    /** The id to store. Undefined when the row supplied nothing, or was refused. */
    value?: string;
    /** Set only when a value arrived that cannot be an Infoodle id. */
    rejected?: string;
}

/**
 * Decide whether a supplied id can be stored, without deciding what to say
 * about it.
 *
 * Both import paths call this. They used to disagree: the CSV importer checked
 * the shape and the group-members route stored whatever arrived, so the same
 * bad value was refused through one door and accepted through the other.
 *
 * Rejection is returned rather than thrown, and the caller decides whether that
 * is a logged mismatch or a silent skip - but no caller may substitute a value.
 */
export function acceptInfoodleId(raw: unknown): AcceptedId {
    const supplied = externalId(raw);
    if (supplied === undefined) return {};
    if (hasInfoodleIdShape(supplied)) return { value: supplied };
    return { rejected: supplied };
}

/**
 * How to explain a rejection, so both paths word it the same way.
 *
 * Names the field, because which column a number arrived in is the only thing
 * that distinguishes a `userId` from a `unique_id`.
 */
export function rejectionMessage(field: InfoodleIdField, supplied: string): string {
    return (
        `${field} "${supplied}" is not an integer, so it cannot be an Infoodle id. ` +
        `Left blank rather than stored.`
    );
}
