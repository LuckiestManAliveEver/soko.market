import { Pool, type PoolConfig } from "pg";
import { createCp2Store, type Cp2Snapshot, type Cp2Store, type Cp2StoreOptions } from "./store.js";

const snapshotId = "default";
const snapshotVersion = 1;

const mutatingMethodNames = new Set([
  "adjustProductStock",
  "approveAgentRoute",
  "authenticateSocialProfile",
  "beginOAuthSession",
  "completeOAuthCallback",
  "confirmProductImport",
  "confirmSupplierImport",
  "createAgentRoute",
  "createBetaSupportTicket",
  "createBusiness",
  "createDataExport",
  "createInvoice",
  "createLaunchIncident",
  "createLogistics",
  "createProduct",
  "createProductCatalogueImport",
  "createRuntimeSession",
  "createRuntimeTurn",
  "createSupplier",
  "createSupplierCsvImport",
  "createCustomer",
  "deleteNetworkSource",
  "deleteProduct",
  "enqueueSyncMutation",
  "loginWithAccountPin",
  "logout",
  "recoverAccountPin",
  "recordBetaDeviceTest",
  "recordBetaTelemetry",
  "recordPayment",
  "rejectAgentRoute",
  "replaySyncQueue",
  "replaySyncQueueItem",
  "requestAccountDeletion",
  "requestOtp",
  "setAccountPin",
  "syncPhoneContacts",
  "syncSocialNetwork",
  "updateBetaAccess",
  "updateBetaFeatureFlag",
  "updateBetaSupportTicketStatus",
  "updateCustomer",
  "updateDeviceTrust",
  "updateLaunchChecklist",
  "updateLaunchIncidentStatus",
  "updateLaunchSettings",
  "updateLogisticsStatus",
  "updateNotificationStatus",
  "updateProduct",
  "updateProductImportRow",
  "updateSupplier",
  "updateSupplierImportRow",
  "updateTaxConfig",
  "updateVerificationTier",
  "verifyAccountPin",
  "verifyExternallyApprovedOtp",
  "verifyOtp"
]);

export interface PostgresCp2StoreOptions extends Cp2StoreOptions {
  databaseUrl: string;
}

export type PostgresCp2Store = Cp2Store & {
  close: () => Promise<void>;
  flush: () => Promise<void>;
};

export async function createPostgresCp2Store(
  options: PostgresCp2StoreOptions
): Promise<PostgresCp2Store> {
  const pool = new Pool(poolConfig(options.databaseUrl));
  await ensureSnapshotTable(pool);

  const store = createCp2Store(
    options.runtimeModelProvider === undefined
      ? {}
      : {
          runtimeModelProvider: options.runtimeModelProvider
        }
  );
  const savedSnapshot = await loadSnapshot(pool);

  if (savedSnapshot !== null) {
    store.hydrateSnapshot(savedSnapshot);
  }

  let saveQueue: Promise<void> = Promise.resolve();

  function enqueueSave(): void {
    saveQueue = saveQueue
      .then(() => saveSnapshot(pool, store.snapshot()))
      .catch((error: unknown) => {
        console.error("Failed to persist CP2 store snapshot.", error);
      });
  }

  async function flush(): Promise<void> {
    await saveQueue;
  }

  async function close(): Promise<void> {
    await flush();
    await pool.end();
  }

  return new Proxy(store, {
    get(target, property, receiver) {
      if (property === "close") {
        return close;
      }

      if (property === "flush") {
        return flush;
      }

      const value = Reflect.get(target, property, receiver);

      if (typeof property !== "string" || typeof value !== "function") {
        return value;
      }

      return (...args: unknown[]) => {
        const result = value.apply(target, args);

        if (!mutatingMethodNames.has(property)) {
          return result;
        }

        if (isPromiseLike(result)) {
          return result.then((resolved: unknown) => {
            enqueueSave();
            return resolved;
          });
        }

        enqueueSave();
        return result;
      };
    }
  }) as PostgresCp2Store;
}

function poolConfig(databaseUrl: string): PoolConfig {
  const sslRequired =
    databaseUrl.includes("sslmode=require") ||
    databaseUrl.includes(".neon.tech") ||
    databaseUrl.includes(".neon.database");

  return {
    connectionString: databaseUrl,
    max: 5,
    ...(sslRequired ? { ssl: { rejectUnauthorized: false } } : {})
  };
}

async function ensureSnapshotTable(pool: Pool): Promise<void> {
  await pool.query(`
    create table if not exists cp2_store_snapshots (
      id text primary key,
      version integer not null,
      data jsonb not null,
      updated_at timestamp with time zone not null
    )
  `);
}

async function loadSnapshot(pool: Pool): Promise<Cp2Snapshot | null> {
  const result = await pool.query<{ data: Cp2Snapshot }>(
    "select data from cp2_store_snapshots where id = $1",
    [snapshotId]
  );

  return result.rows[0]?.data ?? null;
}

async function saveSnapshot(pool: Pool, snapshot: Cp2Snapshot): Promise<void> {
  await pool.query(
    `
      insert into cp2_store_snapshots (id, version, data, updated_at)
      values ($1, $2, $3, now())
      on conflict (id) do update set
        version = excluded.version,
        data = excluded.data,
        updated_at = excluded.updated_at
    `,
    [snapshotId, snapshotVersion, snapshot]
  );
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
