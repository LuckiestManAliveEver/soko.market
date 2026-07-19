import { readAccountDeletionProcessors } from "../dist/cp2/account-deletion-processors.js";
import { createPostgresCp2Store } from "../dist/cp2/postgres-store.js";
import { readDatabaseUrl } from "./database-connection.mjs";

const databaseUrl = readDatabaseUrl();

if (databaseUrl === null) {
  console.error("DATABASE_URL or DIRECT_DATABASE_URL is required to purge expired accounts.");
  process.exit(1);
}

const processors = readAccountDeletionProcessors();
if (processors.length === 0) {
  console.error("At least one account-deletion processor is required before account purge.");
  process.exit(1);
}

const store = await createPostgresCp2Store({
  databaseUrl,
  accountDeletionProcessors: processors
});

try {
  const result = await store.purgeExpiredAccountDeletions(new Date());
  await store.flush();
  console.log(JSON.stringify({ status: "ok", ...result, checkedAt: new Date().toISOString() }));
  if (result.partiallyFailed > 0) process.exitCode = 1;
} finally {
  await store.close();
}
