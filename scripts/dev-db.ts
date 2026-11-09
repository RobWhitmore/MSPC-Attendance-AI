import "dotenv/config";
import { CosmosClient, PartitionKeyKind } from "@azure/cosmos";
import { CONTAINER_NAMES, PARTITION_KEYS } from "../src/server/cosmos.js";

/**
 * Create and seed the local database, so the UI can be worked on without an
 * Azure subscription.
 *
 *   npm run dev:db          create the database and containers, then seed
 *   npm run dev:db -- --reset   delete the database first
 *
 * Points at the Azure Cosmos DB Emulator by default. The emulator's key is
 * published by Microsoft and identical on every machine - it is a well-known
 * constant, not a secret, and it is written here rather than into .env so that
 * nobody has to wonder whether the value in their .env is a real one.
 *
 * Container names and partition keys are imported from cosmos.ts rather than
 * repeated, so local and deployed cannot drift. Partition keys are immutable
 * once a container exists in real Cosmos; testing against a different layout
 * here would be worse than not testing at all.
 */

const EMULATOR_ENDPOINT = "https://localhost:8081/";
const EMULATOR_KEY =
    "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==";

const endpoint = process.env.COSMOS_ENDPOINT || EMULATOR_ENDPOINT;
const key = process.env.COSMOS_KEY || EMULATOR_KEY;
const databaseName = process.env.COSMOS_DATABASE || "mspc";
const isEmulator = endpoint.includes("localhost") || endpoint.includes("127.0.0.1");

/*
  Refuse to touch anything that is not the emulator. This script deletes a
  database and writes fabricated people; pointed at a real account by a stray
  .env it would be destructive, and the seed data would be indistinguishable
  from real records afterwards.
*/
if (!isEmulator) {
    console.error(
        `Refusing to run against ${endpoint}\n\n` +
        `This script seeds test data and can drop the database. It only runs\n` +
        `against the local emulator. Unset COSMOS_ENDPOINT to use it.`
    );
    process.exit(1);
}

// The emulator serves a self-signed certificate. Scoped to this process only.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const adminEmail = (process.env.DEV_ADMIN_EMAIL || "dev@mspc.org.nz").toLowerCase();

async function main() {
    const reset = process.argv.includes("--reset");
    const client = new CosmosClient({ endpoint, key });

    if (reset) {
        try {
            await client.database(databaseName).delete();
            console.log(`dropped database "${databaseName}"`);
        } catch (err: any) {
            if (err?.code !== 404) throw err;
        }
    }

    const { database } = await client.databases.createIfNotExists({ id: databaseName });
    console.log(`database "${databaseName}" ready`);

    for (const name of CONTAINER_NAMES) {
        await database.containers.createIfNotExists({
            id: name,
            partitionKey: { paths: [PARTITION_KEYS[name]], kind: PartitionKeyKind.Hash },
        });
        console.log(`  container ${name.padEnd(13)} ${PARTITION_KEYS[name]}`);
    }

    await seed(database);

    console.log(
        `\nSeeded. Sign in locally as ${adminEmail}\n\n` +
        `  COSMOS_ENDPOINT="${EMULATOR_ENDPOINT}"\n` +
        `  COSMOS_DATABASE="${databaseName}"\n` +
        `  DEV_ADMIN_EMAIL="${adminEmail}"\n`
    );
}

/**
 * Enough data for every tab to render something.
 *
 * No diagnosis anywhere: people carry `qualifies`, and which condition a group
 * serves is carried by its group type, exactly as the real data does.
 */
async function seed(database: any) {
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const today = new Date();
    const inDays = (n: number) => {
        const d = new Date(today);
        d.setDate(d.getDate() + n);
        return iso(d);
    };

    const groupTypes = [
        { id: "gt-ms", shortValue: "MS", longValue: "Multiple Sclerosis Support" },
        { id: "gt-pd", shortValue: "PD", longValue: "Parkinson's Support" },
    ];

    const groups = [
        {
            id: "grp-rangiora-pd", groupTypeId: "gt-pd", name: "Parkinson's - Rangiora Support Group",
            dateRule: "2nd Tuesday", timeRule: "10:00", scheduleText: "Second Tuesday monthly, 10am",
            skipHolidays: true, who: "People with Parkinson's and their carers",
            locationName: "Rangiora Community Centre", locationLink: "",
        },
        {
            id: "grp-chch-ms", groupTypeId: "gt-ms", name: "MS - Christchurch Central",
            dateRule: "1st Thursday", timeRule: "13:30", scheduleText: "First Thursday monthly, 1:30pm",
            skipHolidays: true, who: "People with MS", locationName: "Christchurch Community Hub",
            locationLink: "",
        },
    ];

    // accessCode values are obviously fake on purpose - a realistic-looking one
    // in seed data is a credential nobody is sure is inert.
    const people = [
        { id: "p-1", firstName: "Ana", lastName: "Whitcombe", email: "ana@example.test", type: "member", qualifies: true, accessCode: "DEVCODE-MEMBER-1" },
        { id: "p-2", firstName: "Brian", lastName: "Kerr", email: "brian@example.test", type: "member", qualifies: true, accessCode: "DEVCODE-MEMBER-2" },
        { id: "p-3", firstName: "Cara", lastName: "Nolan", email: "cara@example.test", type: "support", qualifies: false, accessCode: "DEVCODE-SUPPORT-1", supportPersonName: null },
        { id: "p-4", firstName: "Dan", lastName: "Ray", email: "dan@example.test", type: "external", qualifies: false, accessCode: "DEVCODE-LEADER-1" },
        { id: "p-5", firstName: "Esther", lastName: "Vaile", email: "esther@example.test", type: "staff", qualifies: false, accessCode: "DEVCODE-STAFF-1" },
    ];
    // Ana's support person is Cara, by name and by id - the importer resolves
    // one, the app the other, and both paths should have something to read.
    people[0].supportPersonName = "Cara Nolan";
    (people[0] as any).supportPersonId = "p-3";

    const groupMembers = [
        { id: "gm-1", groupId: "grp-rangiora-pd", personId: "p-1", role: "member" },
        { id: "gm-2", groupId: "grp-rangiora-pd", personId: "p-3", role: "support" },
        { id: "gm-3", groupId: "grp-rangiora-pd", personId: "p-4", role: "leader" },
        { id: "gm-4", groupId: "grp-chch-ms", personId: "p-2", role: "member" },
        { id: "gm-5", groupId: "grp-chch-ms", personId: "p-5", role: "staff" },
    ];

    const events = [
        { id: "ev-past", groupId: "grp-rangiora-pd", title: "Parkinson's - Rangiora Support Group", date: inDays(-14), time: "10:00", duration: 90, status: "active", notes: "" },
        { id: "ev-soon", groupId: "grp-rangiora-pd", title: "Parkinson's - Rangiora Support Group", date: inDays(7), time: "10:00", duration: 90, status: "active", notes: "" },
        { id: "ev-ms", groupId: "grp-chch-ms", title: "MS - Christchurch Central", date: inDays(10), time: "13:30", duration: 120, status: "active", notes: "" },
    ];

    const rosters = [
        { id: "r-1", eventId: "ev-past", personId: "p-1", role: "member", rsvpStatus: "booked", attendanceStatus: "present" },
        { id: "r-2", eventId: "ev-past", personId: "p-3", role: "support", rsvpStatus: "booked", attendanceStatus: "present" },
        { id: "r-3", eventId: "ev-past", personId: "p-4", role: "leader", rsvpStatus: "booked", attendanceStatus: "no-show" },
        { id: "r-4", eventId: "ev-soon", personId: "p-1", role: "member", rsvpStatus: "booked", attendanceStatus: "unknown" },
        { id: "r-5", eventId: "ev-soon", personId: "p-4", role: "leader", rsvpStatus: "potential", attendanceStatus: "unknown" },
        { id: "r-6", eventId: "ev-ms", personId: "p-2", role: "member", rsvpStatus: "booked", attendanceStatus: "unknown" },
    ];

    const admins = [{ id: adminEmail, email: adminEmail, role: "superadmin", createdAt: new Date().toISOString() }];

    const now = new Date().toISOString();
    const withTimestamps = (rows: any[]) => rows.map(r => ({ createdAt: now, updatedAt: now, ...r }));

    const sets: [string, any[]][] = [
        ["groupTypes", groupTypes],
        ["groups", groups],
        ["people", people],
        ["groupMembers", groupMembers],
        ["events", events],
        ["rosters", rosters],
        ["admins", admins],
    ];

    for (const [name, rows] of sets) {
        const c = database.container(name);
        for (const row of withTimestamps(rows)) await c.items.upsert(row);
        console.log(`  seeded ${String(rows.length).padStart(2)} ${name}`);
    }
}

main().catch(err => {
    if (String(err?.message ?? "").includes("ECONNREFUSED")) {
        console.error(
            `Could not reach the emulator at ${endpoint}\n\n` +
            `Start it, wait for it to listen on 8081, then run this again:\n` +
            `  & "C:\\Program Files\\Azure Cosmos DB Emulator\\Microsoft.Azure.Cosmos.Emulator.exe"\n`
        );
        process.exit(1);
    }
    console.error(err);
    process.exit(1);
});
