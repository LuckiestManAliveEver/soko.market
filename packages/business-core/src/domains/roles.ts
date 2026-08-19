import { createEvent, type BusinessEvent } from "@soko/event-core";
import type { BusinessRole } from "@soko/shared-types";
import { invalid, type ValidationResult, valid } from "@soko/tool-core";

export interface BusinessActionDraft {
  actionType: string;
  actorId: string;
  aggregateId: string;
  aggregateType: string;
  requiresConfirmation: boolean;
}

export function validateBusinessActionDraft(draft: BusinessActionDraft): ValidationResult {
  const errors: string[] = [];

  if (draft.actionType.trim().length === 0) {
    errors.push("Action type is required.");
  }

  if (draft.actorId.trim().length === 0) {
    errors.push("Actor id is required.");
  }

  if (draft.aggregateId.trim().length === 0) {
    errors.push("Aggregate id is required.");
  }

  if (draft.aggregateType.trim().length === 0) {
    errors.push("Aggregate type is required.");
  }

  return errors.length > 0 ? invalid(...errors) : valid();
}

export function businessActionProposedEvent(input: {
  id: string;
  draft: BusinessActionDraft;
  occurredAt: string;
}): BusinessEvent<{ draft: BusinessActionDraft }> {
  return createEvent({
    id: input.id,
    type: "business_action.proposed",
    aggregateId: input.draft.aggregateId,
    aggregateType: input.draft.aggregateType,
    actorId: input.draft.actorId,
    risk: "low",
    occurredAt: input.occurredAt,
    payload: {
      draft: input.draft
    }
  });
}

export const businessRoles = ["owner", "manager", "sales_agent", "cashier", "view_only"] as const;

export type BusinessPermission =
  | "business:create"
  | "business:read"
  | "membership:read"
  | "membership:manage"
  | "product:read"
  | "product:write"
  | "customer:read"
  | "customer:write"
  | "supplier:read"
  | "supplier:write"
  | "inventory:adjust"
  | "invoice:read"
  | "invoice:write"
  | "invoice:confirm"
  | "payment:read"
  | "payment:write"
  | "logistics:read"
  | "logistics:write"
  | "import:read"
  | "import:write"
  | "report:read"
  | "notification:read"
  | "notification:write"
  | "compliance:read"
  | "compliance:export"
  | "compliance:delete"
  | "verification:read"
  | "verification:write"
  | "tax:read"
  | "tax:write"
  | "device_trust:read"
  | "device_trust:write"
  | "beta:read"
  | "beta:write"
  | "beta:support"
  | "beta:telemetry"
  | "launch:read"
  | "launch:write"
  | "launch:support";

const rolePermissions: Record<BusinessRole, ReadonlySet<BusinessPermission>> = {
  owner: new Set([
    "business:create",
    "business:read",
    "membership:read",
    "membership:manage",
    "product:read",
    "product:write",
    "customer:read",
    "customer:write",
    "supplier:read",
    "supplier:write",
    "inventory:adjust",
    "invoice:read",
    "invoice:write",
    "invoice:confirm",
    "payment:read",
    "payment:write",
    "logistics:read",
    "logistics:write",
    "import:read",
    "import:write",
    "report:read",
    "notification:read",
    "notification:write",
    "compliance:read",
    "compliance:export",
    "compliance:delete",
    "verification:read",
    "verification:write",
    "tax:read",
    "tax:write",
    "device_trust:read",
    "device_trust:write",
    "beta:read",
    "beta:write",
    "beta:support",
    "beta:telemetry",
    "launch:read",
    "launch:write",
    "launch:support"
  ]),
  manager: new Set([
    "business:read",
    "membership:read",
    "product:read",
    "product:write",
    "customer:read",
    "customer:write",
    "supplier:read",
    "supplier:write",
    "inventory:adjust",
    "invoice:read",
    "invoice:write",
    "invoice:confirm",
    "payment:read",
    "payment:write",
    "logistics:read",
    "logistics:write",
    "import:read",
    "import:write",
    "report:read",
    "notification:read",
    "notification:write",
    "compliance:read",
    "verification:read",
    "tax:read",
    "tax:write",
    "device_trust:read",
    "beta:read",
    "beta:support",
    "beta:telemetry",
    "launch:read",
    "launch:support"
  ]),
  sales_agent: new Set([
    "business:read",
    "product:read",
    "customer:read",
    "customer:write",
    "invoice:read",
    "invoice:write",
    "payment:read",
    "logistics:read",
    "logistics:write",
    "import:read",
    "notification:read",
    "tax:read",
    "beta:read",
    "beta:support",
    "beta:telemetry",
    "launch:read",
    "launch:support"
  ]),
  cashier: new Set([
    "business:read",
    "product:read",
    "customer:read",
    "invoice:read",
    "payment:read",
    "payment:write",
    "logistics:read",
    "import:read",
    "notification:read",
    "tax:read",
    "beta:read",
    "beta:support",
    "beta:telemetry",
    "launch:read",
    "launch:support"
  ]),
  view_only: new Set([
    "business:read",
    "product:read",
    "customer:read",
    "supplier:read",
    "tax:read",
    "beta:read",
    "launch:read"
  ])
};

export function isBusinessRole(value: string): value is BusinessRole {
  return businessRoles.includes(value as BusinessRole);
}

export function roleCan(role: BusinessRole, permission: BusinessPermission): boolean {
  return rolePermissions[role]?.has(permission) ?? false;
}

export function permissionsForRole(role: BusinessRole): BusinessPermission[] {
  return [...(rolePermissions[role] ?? new Set<BusinessPermission>())];
}
