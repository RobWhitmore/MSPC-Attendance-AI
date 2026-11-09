import { CosmosClient, Container } from "@azure/cosmos";

/**
 * Cosmos DB connection.
 *
 * Managed Static Web Apps functions have no managed identity and cannot
 * resolve Key Vault references, so the key arrives as a plain app setting that
 * the deployment reads out of Key Vault and writes in. See ARCHITECTURE.md.
 */

function required(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(
            `${name} is not set. The deployment must write every app setting on ` +
            `every run - the appsettings resource replaces the whole collection, ` +
            `so an omitted value is a deletion rather than a no-op.`
        );
    }
    return value;
}

export const CONTAINER_NAMES = [
    "people",
    "groups",
    "groupTypes",
    "events",
    "rosters",
    "groupMembers",
    "admins",
    "auditLogs",
] as const;

export type ContainerName = (typeof CONTAINER_NAMES)[number];

/** Partition key path per container, mirroring the table in ARCHITECTURE.md. */
export const PARTITION_KEYS: Record<ContainerName, string> = {
    people: "/id",
    groups: "/id",
    groupTypes: "/id",
    events: "/groupId",
    rosters: "/eventId",
    groupMembers: "/groupId",
    admins: "/id",
    auditLogs: "/collectionId",
};

let client: CosmosClient | undefined;
const containerCache = new Map<ContainerName, Container>();

function getClient(): CosmosClient {
    if (!client) {
        client = new CosmosClient({
            endpoint: required("COSMOS_ENDPOINT"),
            key: required("COSMOS_KEY"),
        });
    }
    return client;
}

export function container(name: ContainerName): Container {
    let c = containerCache.get(name);
    if (!c) {
        c = getClient().database(required("COSMOS_DATABASE")).container(name);
        containerCache.set(name, c);
    }
    return c;
}

/** The partition key value for an item, derived from its container's key path. */
export function partitionValueOf(name: ContainerName, item: Record<string, unknown>): string {
    const field = PARTITION_KEYS[name].slice(1);
    const value = item[field];
    return typeof value === "string" && value ? value : String(item.id ?? "");
}
