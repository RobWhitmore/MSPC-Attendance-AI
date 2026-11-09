import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

/**
 * Run the test suite.
 *
 * Node's test runner does not discover `.ts` files when handed a directory, and
 * a glob in the npm script is expanded by bash and left alone by cmd.exe - so
 * the file list is built here instead, where the behaviour is the same on both.
 */

const MINIMUM = [22, 3, 0];

/**
 * The route tests substitute the data layer with `mock.module`, which needs
 * Node 22.3 or newer. Refuse rather than quietly run a smaller suite: tests that
 * silently stop covering the security-critical routes are worse than no tests,
 * because the green tick still appears.
 */
/** major.minor.patch as one comparable number, e.g. 22.3.0 -> 22_003_000. */
function versionRank([major, minor, patch]) {
    return major * 1_000_000 + minor * 1_000 + patch;
}

function checkNodeVersion() {
    const current = process.versions.node.split(".").map(Number);
    if (versionRank(current) >= versionRank(MINIMUM)) return;

    console.error(
        `\nThis suite needs Node ${MINIMUM.join(".")} or newer; it is running on ${process.versions.node}.\n` +
        `\n  ${process.execPath}\n` +
        `\nIf your shell has a newer Node than this, something is shadowing it - a\n` +
        `\`node\` package installed into node_modules will do exactly that, and npm\n` +
        `will prefer it over the one on your PATH. Check with:\n` +
        `\n  node --version          # your shell\n` +
        `  npm exec -- node --version   # what npm scripts get\n`
    );
    process.exit(1);
}

checkNodeVersion();

const testDir = "test";
const files = readdirSync(testDir)
    .filter(name => name.endsWith(".test.ts"))
    .map(name => join(testDir, name));

if (files.length === 0) {
    console.error(`No *.test.ts files found in ${testDir}/`);
    process.exit(1);
}

const result = spawnSync(
    process.execPath,
    ["--test", "--import", "tsx", "--experimental-test-module-mocks", ...files],
    { stdio: "inherit" }
);

process.exit(result.status ?? 1);
