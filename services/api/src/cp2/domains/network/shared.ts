import { createHash } from "node:crypto";
import { normalizeDestination } from "../../phone-identity.js";
import { Cp2Error } from "../../cp2-error.js";
export { sanitizeNetworkNode } from "../../network-node-view.js";
export { providerDisplayName } from "../../public-identifiers.js";

export interface NetworkImportConnectionInput {
  name: string;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  providerSubject?: string | null | undefined;
  handle?: string | null | undefined;
}

export interface PhoneContactNetworkInput extends NetworkImportConnectionInput {
  connections?: NetworkImportConnectionInput[] | undefined;
}

export interface SocialProfileNetworkInput extends NetworkImportConnectionInput {
  relationship?: "followed" | "follower" | "interaction" | "message" | undefined;
  connections?: NetworkImportConnectionInput[] | undefined;
}

export interface NormalizedNetworkConnection extends NetworkImportConnectionInput {
  relationship?: SocialProfileNetworkInput["relationship"];
  connections?: NetworkImportConnectionInput[] | undefined;
}

export function normalizeNetworkConnectionInput(
  value: NetworkImportConnectionInput & {
    relationship?: SocialProfileNetworkInput["relationship"];
    connections?: NetworkImportConnectionInput[] | undefined;
  },
  name: string
): NormalizedNetworkConnection {
  const displayName = value.name?.trim();

  if (displayName === undefined || displayName.length < 1) {
    throw new Cp2Error(400, "network_contact_name_required", `${name}.name is required.`);
  }

  return {
    name: displayName,
    phone:
      value.phone === undefined || value.phone === null
        ? null
        : normalizeDestination("phone", value.phone),
    email:
      value.email === undefined || value.email === null
        ? null
        : normalizeDestination("email", value.email),
    providerSubject:
      value.providerSubject === undefined || value.providerSubject === null
        ? null
        : value.providerSubject.trim(),
    handle: value.handle === undefined || value.handle === null ? null : value.handle.trim(),
    relationship: value.relationship,
    connections: value.connections
  };
}

export function normalizeSocialRelationship(
  relationship: SocialProfileNetworkInput["relationship"] | undefined
): NonNullable<SocialProfileNetworkInput["relationship"]> {
  if (
    relationship === "followed" ||
    relationship === "follower" ||
    relationship === "interaction" ||
    relationship === "message"
  ) {
    return relationship;
  }

  return "followed";
}

export function createContactHash(
  hashType: "phone" | "email" | "social",
  rawValue: string
): string {
  const normalized =
    hashType === "phone"
      ? normalizeDestination("phone", rawValue)
      : hashType === "email"
        ? normalizeDestination("email", rawValue)
        : rawValue.trim().toLowerCase();
  return createHash("sha256").update(`${hashType}:${normalized}`).digest("hex");
}

export function createContactDisplayHint(rawValue: string): string | null {
  const normalized = rawValue.trim();

  if (normalized.length <= 4) {
    return null;
  }

  return normalized.slice(-4).padStart(Math.min(normalized.length, 6), "*");
}
