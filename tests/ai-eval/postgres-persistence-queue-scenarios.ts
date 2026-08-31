export interface PostgresPersistenceQueueScenario {
  name: string;
  mutationsWhileSnapshotRuns: number;
  maximumPendingSnapshots: number;
}

/** Frozen burst cases for the production persistence-queue regression. */
export const postgresPersistenceQueueScenarios: PostgresPersistenceQueueScenario[] = [
  {
    name: "sustained writes while one full snapshot is blocked",
    mutationsWhileSnapshotRuns: 50,
    maximumPendingSnapshots: 1
  }
];
