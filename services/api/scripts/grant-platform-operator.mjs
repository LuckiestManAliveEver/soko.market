#!/usr/bin/env node
// Grants or revokes platform-operator authority for one account. This is the ONLY writer of
// cp2_platform_operators (services/api/src/cp2/store.ts requirePlatformOperator) - no API route can
// create, extend, or self-grant this authority. Run directly against the database by whoever
// operates this deployment (e.g. Julien), never invoked by the running application.
//
// Usage:
//   DATABASE_URL=... node services/api/scripts/grant-platform-operator.mjs --phone=+254700000000 --granted-by=julien
//   DATABASE_URL=... node services/api/scripts/grant-platform-operator.mjs --account-id=<uuid> --granted-by=julien
//   DATABASE_URL=... node services/api/scripts/grant-platform-operator.mjs --phone=+254700000000 --revoke
//
// Cp2Store loads grants into memory at API startup. Restart every running API instance after this
// script succeeds so a grant (and, especially, a revocation) takes effect everywhere.
import { pathToFileURL } from "node:url";

export function parseGrantArgs(argv) {
  const flags = new Map(
    argv
      .filter((arg) => arg.startsWith("--"))
      .map((arg) => {
        const [key, ...rest] = arg.slice(2).split("=");
        return [key, rest.join("=")];
      })
  );
  const phone = flags.get("phone");
  const accountId = flags.get("account-id");
  const revoke = flags.has("revoke");
  const grantedBy = flags.get("granted-by");
  if ((phone === undefined) === (accountId === undefined)) {
    throw new Error("Pass exactly one of --phone or --account-id.");
  }
  if (!revoke && (grantedBy === undefined || grantedBy.trim() === "")) {
    throw new Error("--granted-by is required when granting (identify who ran this).");
  }
  return { phone, accountId, revoke, grantedBy };
}

async function resolveAccountId(client, args) {
  if (args.accountId !== undefined) return args.accountId;
  const result = await client.query("select account_id from users where phone_number_e164 = $1", [
    args.phone
  ]);
  const accountId = result.rows[0]?.account_id;
  if (accountId === undefined) {
    throw new Error(`No account found for phone ${args.phone}.`);
  }
  return accountId;
}

async function main() {
  const args = parseGrantArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    const accountId = await resolveAccountId(client, args);
    const accountExists = await client.query("select 1 from accounts where id = $1", [accountId]);
    if (accountExists.rowCount === 0) {
      throw new Error(`Account ${accountId} does not exist.`);
    }
    if (args.revoke) {
      const result = await client.query("delete from cp2_platform_operators where entity_id = $1", [
        accountId
      ]);
      console.log(
        result.rowCount > 0
          ? `Revoked platform-operator authority for account ${accountId}.`
          : `Account ${accountId} did not have platform-operator authority.`
      );
      console.log("Restart every API instance to refresh its platform-operator grant cache.");
      return;
    }
    const record = {
      id: accountId,
      accountId,
      grantedAt: new Date().toISOString(),
      grantedBy: args.grantedBy
    };
    await client.query(
      `insert into cp2_platform_operators (entity_id, account_id, record, updated_at)
       values ($1, $1, $2::jsonb, now())
       on conflict (entity_id) do update set
         account_id = excluded.account_id, record = excluded.record, updated_at = now()`,
      [accountId, JSON.stringify(record)]
    );
    console.log(`Granted platform-operator authority to account ${accountId}.`);
    console.log("Restart every API instance to refresh its platform-operator grant cache.");
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
