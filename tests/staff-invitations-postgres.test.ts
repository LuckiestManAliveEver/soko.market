/**
 * Staff invitations on real PostgreSQL (docs/architecture/staff-invitations.md): invitations and
 * the memberships they create survive a restart, as do role changes and removals. Skipped unless
 * CP2_POSTGRES_TEST_DATABASE_URL points at a database migrated with `pnpm db:migrate`.
 */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { Pool as PgPool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApi } from "../services/api/src/app";
import { createPostgresCp2Store } from "../services/api/src/cp2/postgres-store";
import type { StaffOverviewSummary } from "../packages/shared-types/src";
import { createOwner, ok, request, signUp, uniquePhone } from "./fixtures/fulfillment-test-helpers";

const { Pool } = createRequire(resolve(process.cwd(), "services/api/package.json"))("pg") as {
  Pool: new (options: { connectionString: string }) => PgPool;
};

const databaseUrl = process.env.CP2_POSTGRES_TEST_DATABASE_URL;
const describePostgres = databaseUrl === undefined ? describe.skip : describe;

describePostgres("staff invitations on PostgreSQL", () => {
  let pool: PgPool;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl ?? "" });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("keeps invitations, accepted memberships, role changes and removals across a restart", async () => {
    const first = await createPostgresCp2Store({ databaseUrl: databaseUrl ?? "" });
    const firstApp = buildApi({
      cp2: { store: first },
      mutationPersistenceFlush: () => first.flush()
    });
    const owner = await createOwner(firstApp, "Persistent Staff Wholesale");
    const staffUrl = (path = "") => `/businesses/${owner.businessId}/staff${path}`;

    const pendingPhone = uniquePhone();
    const pending = await ok<{ id: string }>(
      firstApp,
      "POST",
      staffUrl("/invitations"),
      owner.cookie,
      {
        phone: `+${pendingPhone}`,
        role: "driver",
        name: "Not yet"
      }
    );
    const joiners: Array<{ phone: string; cookie: string; userId: string; membershipId: string }> =
      [];
    for (const role of ["sales_agent", "cashier", "driver"]) {
      const phone = uniquePhone();
      const invitation = await ok<{ id: string; joinToken: string }>(
        firstApp,
        "POST",
        staffUrl("/invitations"),
        owner.cookie,
        {
          phone: `+${phone}`,
          role,
          name: role
        }
      );
      const person = await signUp(firstApp, phone);
      const accepted = await ok<{ membership: { id: string } }>(
        firstApp,
        "POST",
        `/v1/staff-invitations/${invitation.id}/accept`,
        person.cookie,
        // The first joiner uses the link sent to their number; the proof must survive a restart.
        role === "sales_agent" ? { joinToken: invitation.joinToken } : undefined
      );
      joiners.push({ phone, ...person, membershipId: accepted.membership.id });
    }
    const [promoted, removed, leaver] = joiners as [
      (typeof joiners)[0],
      (typeof joiners)[0],
      (typeof joiners)[0]
    ];
    await ok(firstApp, "PATCH", staffUrl(`/members/${promoted.membershipId}`), owner.cookie, {
      role: "manager"
    });
    await ok(firstApp, "DELETE", staffUrl(`/members/${removed.membershipId}`), owner.cookie);
    await ok(firstApp, "POST", staffUrl("/leave"), leaver.cookie);
    const revoked = await ok<{ id: string }>(
      firstApp,
      "POST",
      staffUrl("/invitations"),
      owner.cookie,
      {
        phone: `+${uniquePhone()}`,
        role: "cashier",
        name: "Revoked"
      }
    );
    await ok(firstApp, "POST", staffUrl(`/invitations/${revoked.id}/revoke`), owner.cookie);
    const declinedPhone = uniquePhone();
    const declined = await ok<{ id: string }>(
      firstApp,
      "POST",
      staffUrl("/invitations"),
      owner.cookie,
      {
        phone: `+${declinedPhone}`,
        role: "cashier",
        name: "Declined"
      }
    );
    const decliner = await signUp(firstApp, declinedPhone);
    await ok(firstApp, "POST", `/v1/staff-invitations/${declined.id}/decline`, decliner.cookie);
    await first.flush();
    await firstApp.close();

    const rows = await pool.query<{ status: string }>(
      "select record->>'status' as status from cp2_staff_invitations where business_id = $1",
      [owner.businessId]
    );
    expect(rows.rows.map((row) => row.status).sort()).toEqual([
      "accepted",
      "accepted",
      "accepted",
      "declined",
      "pending",
      "revoked"
    ]);
    const memberships = await pool.query<{ user_id: string; role: string }>(
      "select user_id, role from business_memberships where business_id = $1",
      [owner.businessId]
    );
    expect(memberships.rows.map((row) => row.role).sort()).toEqual(["manager", "owner"]);

    const restored = await createPostgresCp2Store({ databaseUrl: databaseUrl ?? "" });
    const restoredApp = buildApi({ cp2: { store: restored } });
    const overview = await ok<StaffOverviewSummary>(restoredApp, "GET", staffUrl(), owner.cookie);
    expect(overview.invitations.map((invitation) => invitation.id)).toEqual([pending.id]);
    // The decline survived too: re-inviting within the cooldown is still refused.
    expect(
      (
        await request<{ code: string }>(
          restoredApp,
          "POST",
          staffUrl("/invitations"),
          owner.cookie,
          {
            phone: `+${declinedPhone}`,
            role: "cashier",
            name: "Again"
          }
        )
      ).body.code
    ).toBe("staff_invitation_recently_declined");
    expect(overview.members.map((member) => member.role)).toEqual(["owner", "manager"]);
    expect(overview.members[1]).toMatchObject({ userId: promoted.userId, confirmedByLink: true });
    expect(overview.invitations[0]?.joinToken).toMatch(/^[A-Za-z0-9_-]{24}$/u);
    // The promoted manager's access survived the restart; the removed and departed did not.
    expect((await request(restoredApp, "GET", staffUrl(), promoted.cookie)).status).toBe(200);
    for (const gone of [removed, leaver]) {
      expect(
        (await request(restoredApp, "GET", `/businesses/${owner.businessId}/invoices`, gone.cookie))
          .status
      ).toBe(403);
    }
    // The still-pending invitation can be accepted after the restart.
    const late = await signUp(restoredApp, pendingPhone);
    await ok(restoredApp, "POST", `/v1/staff-invitations/${pending.id}/accept`, late.cookie);
    await restoredApp.close();
  }, 60_000);
});
