import { createPostgresCp2Store } from "../dist/cp2/postgres-store.js";
import { readDatabaseUrl } from "./database-connection.mjs";

const databaseUrl = readDatabaseUrl();

if (databaseUrl === null) {
  console.error("DATABASE_URL or DIRECT_DATABASE_URL is required to purge expired shops.");
  process.exit(1);
}

const store = await createPostgresCp2Store({ databaseUrl });

try {
  const purged = store.purgeExpiredShopDeletions(new Date());
  await store.flush();
  console.log(JSON.stringify({ status: "ok", purged, checkedAt: new Date().toISOString() }));
} finally {
  await store.close();
}
