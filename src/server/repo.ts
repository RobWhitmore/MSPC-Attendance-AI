import { randomUUID } from "crypto";
import type { SqlParameter } from "@azure/cosmos";
import { container, partitionValueOf, type ContainerName } from "./cosmos.js";

/**
 * The only place that talks to Cosmos.
 *
 * Deliberately not a Firestore emulation. A shim that accepted
 * `collection(...).where(...)` would look identical at the call site and differ
 * in semantics - which is the failure mode that is hardest to find later.
 */

export type Doc = Record<string, any>;

/**
 * What Cosmos will accept as a query parameter. Callers pass ordinary values;
 * this is the one place that has to say so in the SDK's terms.
 */
type QueryValue = SqlParameter["value"];

/** Cosmos system properties, never sent to a client. */
const SYSTEM_FIELDS = ["_rid", "_self", "_etag", "_attachments", "_ts"];

function clean<T extends Doc>(item: T): T {
    const out = { ...item };
    for (const f of SYSTEM_FIELDS) delete out[f];
    return out;
}

/** A new document id. Firestore auto-ids and these are both valid Cosmos ids. */
export function newId(): string {
    return randomUUID().replace(/-/g, "");
}

/**
 * Cosmos has no server-side timestamp sentinel, so time is taken here.
 * ISO 8601 survives a JSON round-trip; a Firestore Timestamp does not.
 */
export function nowIso(): string {
    return new Date().toISOString();
}

export async function queryAll<T extends Doc = Doc>(
    name: ContainerName,
    query: string,
    parameters: SqlParameter[] = []
): Promise<T[]> {
    const { resources } = await container(name)
        .items.query<T>({ query, parameters }, { maxItemCount: -1 })
        .fetchAll();
    return resources.map(clean);
}

export async function getById<T extends Doc = Doc>(
    name: ContainerName,
    id: string,
    partitionValue?: string
): Promise<T | null> {
    if (!id) return null;
    try {
        const { resource } = await container(name).item(id, partitionValue ?? id).read<T>();
        return resource ? clean(resource) : null;
    } catch (err: any) {
        if (err?.code === 404) return null;
        throw err;
    }
}

/**
 * Read by id when the partition key is not the id and the caller does not know
 * it - a point read is cheaper, but a one-item query is correct everywhere.
 */
export async function findById<T extends Doc = Doc>(
    name: ContainerName,
    id: string
): Promise<T | null> {
    if (!id) return null;
    const rows = await queryAll<T>(name, "SELECT * FROM c WHERE c.id = @id", [
        { name: "@id", value: id },
    ]);
    return rows[0] ?? null;
}

export async function listAll<T extends Doc = Doc>(name: ContainerName): Promise<T[]> {
    return queryAll<T>(name, "SELECT * FROM c");
}

/**
 * Equality on one field. `field` is interpolated because Cosmos cannot
 * parameterise an identifier - every call site passes a literal, and
 * `assertFieldName` refuses anything that is not a bare property name.
 */
export async function byField<T extends Doc = Doc>(
    name: ContainerName,
    field: string,
    value: QueryValue
): Promise<T[]> {
    assertFieldName(field);
    return queryAll<T>(name, `SELECT * FROM c WHERE c.${field} = @value`, [
        { name: "@value", value },
    ]);
}

/** Equality on two fields, the `where(...).where(...)` pattern the routes use. */
export async function byFields<T extends Doc = Doc>(
    name: ContainerName,
    fields: Record<string, QueryValue>
): Promise<T[]> {
    const entries = Object.entries(fields);
    entries.forEach(([f]) => assertFieldName(f));
    const where = entries.map(([f], i) => `c.${f} = @p${i}`).join(" AND ");
    const parameters = entries.map(([, v], i) => ({ name: `@p${i}`, value: v }));
    return queryAll<T>(name, `SELECT * FROM c WHERE ${where}`, parameters);
}

/**
 * Membership test. Replaces Firestore's `where(field, "in", chunk)` and its
 * 30-value ceiling - Cosmos takes the whole array as one parameter, so the
 * chunking loops in the old routes are gone rather than merely widened.
 */
export async function byFieldIn<T extends Doc = Doc>(
    name: ContainerName,
    field: string,
    values: readonly QueryValue[]
): Promise<T[]> {
    assertFieldName(field);
    if (values.length === 0) return [];
    return queryAll<T>(
        name,
        `SELECT * FROM c WHERE ARRAY_CONTAINS(@values, c.${field})`,
        [{ name: "@values", value: [...values] }]
    );
}

export async function byIds<T extends Doc = Doc>(
    name: ContainerName,
    ids: readonly string[]
): Promise<T[]> {
    return byFieldIn<T>(name, "id", ids);
}

export async function upsert<T extends Doc>(name: ContainerName, item: T): Promise<T> {
    const { resource } = await container(name).items.upsert<T>(item);
    return clean(resource as T);
}

/**
 * Firestore's `set(..., { merge: true })`: create when absent, shallow-merge
 * when present. Cosmos's own patch operation 404s on a missing item, which is
 * not what any of the call sites want.
 */
export async function setMerge<T extends Doc>(
    name: ContainerName,
    id: string,
    updates: Doc,
    partitionValue?: string
): Promise<T> {
    const pk = partitionValue ?? partitionValueOf(name, { id, ...updates });
    const existing = await getById(name, id, pk);
    const merged = { ...(existing ?? {}), ...updates, id } as unknown as T;
    return upsert<T>(name, merged);
}

export async function remove(
    name: ContainerName,
    id: string,
    partitionValue?: string
): Promise<void> {
    try {
        await container(name).item(id, partitionValue ?? id).delete();
    } catch (err: any) {
        if (err?.code !== 404) throw err;
    }
}

/** Delete many. Cosmos has no batch delete across partitions; this is small-N by design. */
export async function removeMany(name: ContainerName, items: Doc[]): Promise<number> {
    let deleted = 0;
    for (const item of items) {
        await remove(name, String(item.id), partitionValueOf(name, item));
        deleted++;
    }
    return deleted;
}

function assertFieldName(field: string): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) {
        throw new Error(`Unsafe Cosmos field name: ${field}`);
    }
}
