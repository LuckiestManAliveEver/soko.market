function positiveIntegerFromEnv(name, fallback, environment = process.env) {
  const value = environment[name];

  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

// Filenames whose SQL text no longer byte-for-byte matches what a live database recorded in
// `soko_schema_migrations` when the migration actually ran, together with every checksum
// verified to have been legitimately applied for that file. This is an explicit, audited
// allowlist keyed by exact checksum - not a way to silence checksum drift in general. A
// migration runner still fails closed for any applied checksum that is not exactly one of the
// values listed here (see isAcceptedMigrationChecksum below).
const legacyMigrationChecksums = new Map([
  [
    "014_cp2_phase1_auth_security_relational.sql",
    new Set([
      "bd441b79fc96f268acba7a251cb12d688a61b98b5d608809924ede780d84282a",
      "695019b487acf03ba6dfe87c64c5dd4204bbb52bfb9d551d8623cff2519560a6"
    ])
  ]
  // 051_single_identity_single_store.sql: Render's build fails with "Migration checksum
  // mismatch for 051_single_identity_single_store.sql" because production's
  // soko_schema_migrations row for that file was stamped with a checksum that does not match
  // this file's current SHA-256.
  //
  // Investigated 2026-08: `git log --all --follow -- infra/db/migrations/051_single_identity_single_store.sql`
  // returns exactly one commit (49504ff, "Enforce single identity and store registration") -
  // no other commit, branch, stash, or reflog entry in this repository holds a different
  // version of the file, so the originally-applied SQL text cannot be reconstructed from source
  // control. No production database connection (DIRECT_DATABASE_URL/DATABASE_URL) was available
  // in the environment where this was investigated, so the deployed checksum could not be read
  // either. Do NOT add a guessed value here - an unverified entry would let an unverified
  // migration state through silently, which defeats the point of this allowlist.
  //
  // To unblock deployment: an operator with production database access must run
  //   SELECT filename, checksum, applied_at, duration_ms
  //   FROM soko_schema_migrations
  //   WHERE filename = '051_single_identity_single_store.sql';
  // and add the returned checksum here as its own entry, e.g.:
  //   ["051_single_identity_single_store.sql", new Set(["<verified checksum from the query above>"])]
]);

export function isAcceptedMigrationChecksum(
  filename,
  appliedChecksum,
  currentChecksum,
  legacyChecksums = legacyMigrationChecksums
) {
  return (
    appliedChecksum === currentChecksum ||
    legacyChecksums.get(filename)?.has(appliedChecksum) === true
  );
}

export { legacyMigrationChecksums };

export function normalizeDatabaseUrl(connectionString) {
  return connectionString
    .trim()
    .replace(/([?&])sslmode=(?:prefer|require|verify-ca)(?=&|$)/gi, "$1sslmode=verify-full");
}

export function readDatabaseUrl(environment = process.env) {
  for (const name of ["DIRECT_DATABASE_URL", "DATABASE_URL"]) {
    const value = environment[name];
    if (value !== undefined && value.trim() !== "") {
      return normalizeDatabaseUrl(value);
    }
  }

  return null;
}

export function databasePoolConfig(
  connectionString,
  {
    applicationName = "soko-market-db-task",
    environment = process.env,
    max,
    poolMaxFallback = 1,
    useQueryTimeouts = true
  } = {}
) {
  const normalizedConnectionString = normalizeDatabaseUrl(connectionString);
  const sslRequired =
    !/[?&]sslmode=/i.test(normalizedConnectionString) &&
    (normalizedConnectionString.includes(".neon.tech") ||
      normalizedConnectionString.includes(".neon.database"));

  return {
    application_name: applicationName,
    connectionString: normalizedConnectionString,
    connectionTimeoutMillis: positiveIntegerFromEnv("DB_CONNECTION_TIMEOUT_MS", 5000, environment),
    idleTimeoutMillis: positiveIntegerFromEnv("DB_IDLE_TIMEOUT_MS", 30000, environment),
    max: max ?? positiveIntegerFromEnv("DB_POOL_MAX", poolMaxFallback, environment),
    ...(useQueryTimeouts
      ? {
          query_timeout: positiveIntegerFromEnv("DB_QUERY_TIMEOUT_MS", 15000, environment),
          statement_timeout: positiveIntegerFromEnv("DB_STATEMENT_TIMEOUT_MS", 15000, environment)
        }
      : {}),
    ...(sslRequired ? { ssl: true } : {})
  };
}
