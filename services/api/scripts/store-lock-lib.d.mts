interface Queryable {
  query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export const storeLockPredicate: string;

export function findStoreLockHolders(client: Queryable): Promise<{
  holders: { pid: number; granted: boolean; state: string | null }[];
  waiters: { pid: number; granted: boolean; state: string | null }[];
}>;

export function releaseLeakedStoreLockHolders(
  client: Queryable
): Promise<{ pid: number; terminated: boolean }[]>;
