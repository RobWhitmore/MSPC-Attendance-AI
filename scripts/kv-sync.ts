import "dotenv/config";
import { SecretClient } from "@azure/keyvault-secrets";
import { DefaultAzureCredential } from "@azure/identity";

/**
 * Move secrets from .env into Key Vault, and read them back out at deploy time.
 *
 *   npm run kv-sync -- push <vault-name>     .env  -> Key Vault
 *   npm run kv-sync -- check <vault-name>    assert each secret is present and sane
 *
 * Nothing here prints a secret value, and nothing puts one on a command line
 * where it would land in shell history. `check` asserts on length and on there
 * being no non-printable characters, without showing you what it checked.
 *
 * That last part is not fussiness. `az` emits CRLF on Windows; `$(az ...)`
 * strips the \n and leaves the \r, and a key with a trailing carriage return
 * looks correct in every tool that displays it and then fails days later as a
 * database login error.
 */

const SECRETS = [
    { env: "COSMOS_KEY", secret: "cosmos-key", minLength: 40 },
] as const;

const [command, vaultName] = process.argv.slice(2);

if (!command || !vaultName) {
    console.error("Usage: npm run kv-sync -- <push|check> <vault-name>");
    process.exit(1);
}

const client = new SecretClient(
    `https://${vaultName}.vault.azure.net`,
    new DefaultAzureCredential()
);

/** Present, long enough, and free of the characters that survive a bad capture. */
function validate(name: string, value: string | undefined): string[] {
    const problems: string[] = [];
    if (!value) {
        problems.push(`${name}: missing or empty`);
        return problems;
    }
    if (/[\r\n]/.test(value)) {
        problems.push(`${name}: contains a carriage return or newline (a captured value that was not stripped)`);
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(value)) {
        problems.push(`${name}: contains a non-printable character`);
    }
    if (value !== value.trim()) {
        problems.push(`${name}: has leading or trailing whitespace`);
    }
    return problems;
}

async function push() {
    let pushed = 0;
    const problems: string[] = [];

    for (const { env, secret, minLength } of SECRETS) {
        const value = process.env[env];
        const found = validate(env, value);
        if (value && value.length < minLength) {
            found.push(`${env}: only ${value.length} characters, expected at least ${minLength}`);
        }
        if (found.length > 0) {
            problems.push(...found);
            continue;
        }
        await client.setSecret(secret, value!);
        console.log(`  pushed  ${secret}  (${value!.length} characters)`);
        pushed++;
    }

    if (problems.length > 0) {
        console.error("\nRefusing to continue:");
        for (const p of problems) console.error(`  - ${p}`);
        process.exit(1);
    }
    console.log(`\n${pushed} secrets pushed to ${vaultName}.`);
}

async function check() {
    const problems: string[] = [];

    for (const { secret, minLength, env } of SECRETS) {
        let value: string | undefined;
        try {
            value = (await client.getSecret(secret)).value;
        } catch {
            problems.push(`${secret}: not present in ${vaultName}`);
            continue;
        }
        const found = validate(secret, value);
        if (value && value.length < minLength) {
            found.push(`${secret}: only ${value.length} characters, expected at least ${minLength}`);
        }
        if (found.length > 0) {
            problems.push(...found);
        } else {
            console.log(`  ok      ${secret}  (${value!.length} characters, maps to ${env})`);
        }
    }

    if (problems.length > 0) {
        console.error("\nProblems found:");
        for (const p of problems) console.error(`  - ${p}`);
        console.error("\nAn empty or malformed app setting is a deletion, not a no-op.");
        process.exit(1);
    }
    console.log(`\nAll secrets in ${vaultName} are present and well-formed.`);
}

const run = command === "push" ? push : command === "check" ? check : null;
if (!run) {
    console.error(`Unknown command "${command}". Use push or check.`);
    process.exit(1);
}

run().catch(err => {
    console.error("kv-sync failed:", err.message ?? err);
    process.exit(1);
});
