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

const legacyMigrationChecksums = new Map([
  [
    "014_cp2_phase1_auth_security_relational.sql",
    new Set([
      "bd441b79fc96f268acba7a251cb12d688a61b98b5d608809924ede780d84282a",
      "695019b487acf03ba6dfe87c64c5dd4204bbb52bfb9d551d8623cff2519560a6"
    ])
  ]
]);

export function isAcceptedMigrationChecksum(filename, appliedChecksum, currentChecksum) {
  return (
    appliedChecksum === currentChecksum ||
    legacyMigrationChecksums.get(filename)?.has(appliedChecksum) === true
  );
}

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
