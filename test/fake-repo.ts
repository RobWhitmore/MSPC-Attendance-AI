/**
 * An in-memory stand-in for src/server/repo.ts.
 *
 * There is no Cosmos emulator on this machine and no Azure subscription yet, so
 * the alternative to this was route code that had never executed. Every read and
 * write in the app goes through that one module, which makes it a clean seam:
 * the routes, the auth gate, the classification rules and the serialisation all
 * run for real against this.
 *
 * It is not a Cosmos simulator. It matches the contract repo.ts exposes, which
 * is what the routes are written against.
 */

export type Doc = Record<string, any>;

let store: Record<string, Doc[]> = {};
let idCounter = 0;

/** Replace the whole dataset. Call from a beforeEach so tests cannot leak into each other. */
export function seed(data: Record<string, Doc[]>): void {
    store = {};
    for (const [name, docs] of Object.entries(data)) {
        store[name] = docs.map(d => ({ ...d }));
    }
    idCounter = 0;
}

export function dump(name: string): Doc[] {
    return (store[name] ?? []).map(d => ({ ...d }));
}

function collection(name: string): Doc[] {
    if (!store[name]) store[name] = [];
    return store[name];
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

// --- the repo.ts surface ----------------------------------------------------

export function newId(): string {
    idCounter++;
    return `generated-${idCounter}`;
}

export function nowIso(): string {
    return "2026-08-11T00:00:00.000Z";
}

export async function listAll<T extends Doc = Doc>(name: string): Promise<T[]> {
    return clone(collection(name)) as T[];
}

export async function getById<T extends Doc = Doc>(name: string, id: string): Promise<T | null> {
    if (!id) return null;
    const found = collection(name).find(d => d.id === id);
    return found ? (clone(found) as T) : null;
}

export async function findById<T extends Doc = Doc>(name: string, id: string): Promise<T | null> {
    return getById<T>(name, id);
}

export async function byField<T extends Doc = Doc>(
    name: string,
    field: string,
    value: unknown
): Promise<T[]> {
    return clone(collection(name).filter(d => d[field] === value)) as T[];
}

export async function byFields<T extends Doc = Doc>(
    name: string,
    fields: Record<string, unknown>
): Promise<T[]> {
    return clone(
        collection(name).filter(d => Object.entries(fields).every(([f, v]) => d[f] === v))
    ) as T[];
}

export async function byFieldIn<T extends Doc = Doc>(
    name: string,
    field: string,
    values: readonly unknown[]
): Promise<T[]> {
    if (values.length === 0) return [];
    const wanted = new Set(values);
    return clone(collection(name).filter(d => wanted.has(d[field]))) as T[];
}

export async function byIds<T extends Doc = Doc>(name: string, ids: readonly string[]): Promise<T[]> {
    return byFieldIn<T>(name, "id", ids);
}

export async function upsert<T extends Doc>(name: string, item: T): Promise<T> {
    const docs = collection(name);
    const index = docs.findIndex(d => d.id === item.id);
    const stored = clone(item);
    if (index === -1) docs.push(stored);
    else docs[index] = stored;
    return clone(stored);
}

export async function setMerge<T extends Doc>(
    name: string,
    id: string,
    updates: Doc
): Promise<T> {
    const existing = (await getById(name, id)) ?? {};
    return upsert(name, { ...existing, ...updates, id } as unknown as T);
}

export async function remove(name: string, id: string): Promise<void> {
    const docs = collection(name);
    const index = docs.findIndex(d => d.id === id);
    if (index !== -1) docs.splice(index, 1);
}

export async function removeMany(name: string, items: Doc[]): Promise<number> {
    let deleted = 0;
    for (const item of items) {
        await remove(name, String(item.id));
        deleted++;
    }
    return deleted;
}

export async function queryAll<T extends Doc = Doc>(name: string): Promise<T[]> {
    return listAll<T>(name);
}
