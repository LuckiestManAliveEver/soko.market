import { createPostgresCp2Store } from "../dist/cp2/postgres-store.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.trim() === "") {
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
