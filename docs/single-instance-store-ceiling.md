# Single-instance store ceiling

Status: known limitation, tracked, not fixed. Safe for closed beta. Must be resolved (or explicitly
re-accepted) before running more than one API instance or before tenant data outgrows one
process's memory.

## The problem

`createPostgresCp2Store` (`services/api/src/cp2/postgres-store.ts`) boots by calling
`loadNormalizedSnapshot`, which reads every one of the ~100 collections listed in
`normalizedCollections` plus the relational core tables into memory, then hands that snapshot to
`createCp2Store` (`services/api/src/cp2/store.ts`, ~20k lines). From then on:

- Every read and mutation runs synchronously against in-process JS `Map`/array state inside the
  `Cp2Store` class. There is no per-request database query for business logic.
- Writes are mirrored to Postgres asynchronously afterward (`enqueueSave` -> `saveNormalizedSnapshot`),
  which is durable but means the source of truth for reads is always the in-memory copy, not
  Postgres.
- This is enforced, not incidental: `assertDatabaseMigrated` requires the schema to be current, and
  a `Proxy` wraps every mutating method to trigger the async persistence queue - the design assumes
  exactly one process holds the canonical in-memory state.

Consequences:

- **Memory-bound**: total tenant data must fit in one process's heap. Fine at closed-beta scale;
  will eventually stop being fine as data grows, with no natural early warning besides an OOM crash.
- **Single-instance only**: a second API instance would boot its own independent in-memory
  snapshot and diverge from the first the moment either one accepts a write. Postgres `LISTEN`/
  `NOTIFY` (`realtimeChannel` in `postgres-store.ts`) fans out change *notifications* between
  instances for the sync protocol, but does not make two in-memory copies of the same mutable
  state consistent. Do not add a second `soko-market-api` instance (or Render autoscaling) until
  this is resolved.
- **Restart loses the persistence queue's in-flight tail**: writes are queued and flushed async;
  a hard crash between a completed HTTP response and the queued Postgres write landing can lose
  that write. `DB_PERSISTENCE_QUEUE_WARN_MS` and `/health/ready`'s `persistenceQueue` block exist
  to make this queue depth observable - watch it.

## This is not the same problem as the CP2 retirement plan

[`docs/cp2-compatibility-retirement-plan.md`](./cp2-compatibility-retirement-plan.md) retires the
`cp2_*` JSONB compatibility tables in favor of proper relational tables as the *persisted* schema.
That work is real progress and mostly landed (core business collections and phase 1 auth tables
already read from relational tables). But it changes what `loadNormalizedSnapshot` reads *from* -
it does not change the fact that the whole dataset still gets loaded into one process's memory at
boot and mutated in-process. Finishing that plan does not, by itself, remove the single-instance
ceiling described here.

## The same root cause affects auth rate-limiting

Three separate sliding-window counters live as plain in-memory `Map`s, for the same reason as
everything else in `Cp2Store` - they were built as part of the same synchronous, single-process
model:

- `otpRequestHistory` and `failedPinAttempts` in `services/api/src/cp2/store.ts`
  (`requireOtpRequestAllowed`, `requirePinAttemptAllowed`, and related private methods).
- `authAttemptsByIp` in `services/api/src/cp2/routes.ts` (`enforceAuthIpRate`, used by
  `/auth/signup/start`, `/auth/login/password`, `/auth/recovery/start`, `/auth/password/change`).

These are real, working brute-force defenses today - they are just per-process and reset on
restart, and would not be shared across a second instance for the same reason the rest of the
store wouldn't be.

**What's already fixed (this pass):** HTTP-level request throttling is now handled by
`@fastify/rate-limit`, backed by a shared Redis instance (`soko-market-rate-limit-cache` in
`render.yaml`, wired via `REDIS_URL`) in both `services/api` and `services/ai-runtime`. This is a
coarse, additive backstop across the *entire* request surface (previously there was none at all
outside a handful of specific auth routes) and survives restarts/would work correctly if these
services ever run more than one instance. It does not replace the three counters above, which stay
as the precise, purpose-specific brute-force limits they already were.

**What's deliberately not touched:** migrating `otpRequestHistory` / `failedPinAttempts` /
`authAttemptsByIp` to Redis was considered and set aside for this pass. Every method on `Cp2Store`
is synchronous by design; making these three counters Redis-backed means making their call chains
async, which cascades through the auth-critical methods that call them
(`loginWithAccountPin`, `verifyOtp`, `requestOtp`, signup/recovery/password-change flows). That's a
real, scoped follow-up, but it touches security-critical code in a 20k-line file and deserves its
own reviewed change, not a same-session addition alongside everything else in this pass.

## Why this isn't being rewritten in this pass

- `store.ts` + `postgres-store.ts` together are ~24k lines, covering ~100 collections and ~150
  mutating methods, all synchronous by design.
- The actual fix - stop hydrating a full in-memory snapshot at boot, make `Cp2Store` methods query
  Postgres per request - means converting every one of those methods from sync to async and
  re-verifying transactional correctness (invoice confirmation + inventory movement, payment +
  balance updates, etc.) without the in-memory snapshot's implicit single-process atomicity to lean
  on.
- That's a multi-week rewrite touching auth, payments, and inventory simultaneously. Attempting it
  in one sitting risks shipping something that looks done but silently breaks a transactional
  guarantee - worse than leaving the documented limitation in place.
- This matches the original assessment in
  [`documentation/POSTGRES_PRODUCTION_READINESS_PLAN.md`](../documentation/POSTGRES_PRODUCTION_READINESS_PLAN.md):
  Postgres persistence was added first (done), full relational read/write was always the follow-on
  (not done).

## Recommended path, in order

1. **Now / cheap**: monitor process RSS in production and alert before it approaches the Render
   plan's memory limit; treat "add a second API instance" as blocked until step 3 lands. (Today's
   `starter` plan is single-instance already, so there's no accidental exposure yet - this is
   about not reaching for horizontal scaling as the fix when load grows.)
2. **Scoped follow-up**: make `otpRequestHistory`, `failedPinAttempts`, and `authAttemptsByIp`
   Redis-backed (the Redis instance now exists - see above). Smaller surface than the full rewrite,
   directly removes the "resets on restart" and "wouldn't work with >1 instance" gaps for the most
   security-sensitive remaining in-memory state. Needs its own PR with auth test coverage, since it
   changes sync methods to async on hot auth paths.
3. **The real fix**: extend the phased, collection-by-collection approach that
   `cp2-compatibility-retirement-plan.md` already uses successfully (dual-write, checksum parity,
   switch reads, retire) to the in-memory layer itself - one collection at a time, moving from
   "hydrated into memory at boot" to "queried from Postgres per request," starting with the
   collections least entangled with cross-collection business logic. Size and schedule this as its
   own multi-week project, not a patch.
