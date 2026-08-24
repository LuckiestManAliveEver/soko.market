/**
 * Sixth slice of in-process domain modularization for the Cp2Store monolith (see
 * docs/architecture/domain-modularization-roadmap.md). Owns the phone/social contact-graph
 * Maps: `networkNodes`, `networkEdges`, `networkSources`, `networkPermissions`,
 * `networkRoutes`, `contactHashes` (+ derived `contactHashIdByValue`), `externalIdentities`
 * (+ derived `externalIdentityIdBySubject`), and `sokoIdentityLinks` - plus every method that
 * reads/writes them directly.
 *
 * Unlike every domain extracted so far, this one is **user-scoped, not business-scoped**: its
 * public methods gate on `requirePinVerifiedSession`, never `requireAuthorizedSession`, and
 * none of them take a `businessId`. That's why `deleteShopOwnedData` (the business-scoped
 * purge) never touches any of these Maps, while `deleteAccountOwnedData` (the account/user-
 * scoped purge) does.
 *
 * The coupling for this domain runs in the opposite direction from most prior slices: instead
 * of cross-cutting report builders reaching into this domain, this domain's own methods
 * (`syncConnectedSocialProvider`, `findSokoIdentityLink`) reach into the not-yet-extracted core
 * auth/identity kernel (`accounts`, `userByAccount`, `memberships`, `businesses`,
 * `userIdentities`) to auto-link a contact to an existing Soko account. All five are injected
 * as read-only raw `Map` references, the same pattern already used elsewhere.
 *
 * `CommerceDomain` and `SupplierDomain` were both extracted before this domain existed, so they
 * already receive `networkNodes`/`networkSources` as raw `Map` references via their own deps
 * interfaces. Both only ever read those Maps (confirmed - never `.set()`/`.delete()`), so
 * `Cp2Store`'s constructor now points those same deps at `this.networkDomain.networkNodesMap`/
 * `networkSourcesMap` instead of its own former private fields - zero code change needed inside
 * either of those two domain files. `requirePhonebookNode` (used only by `SupplierDomain`) moved
 * here too, since it operates purely on `networkNodes`; `sanitizeNetworkNode` moved to this
 * domain's `shared.ts` and is imported directly by `SupplierDomain`'s own file (no `this`
 * dependency, so no callback injection needed, same as `roundMoney`/`money.ts`).
 */
import { randomUUID } from "node:crypto";
import type {
  AccountSummary,
  AgentRouteSummary,
  AuthSessionView,
  BusinessSummary,
  ContactHashSummary,
  ExternalIdentitySummary,
  MembershipSummary,
  NetworkConsentStatus,
  NetworkEdgeSourceType,
  NetworkEdgeSummary,
  NetworkGraphSummary,
  NetworkNodeSummary,
  NetworkPermissionSummary,
  NetworkSyncSourceSummary,
  NetworkVisibilityStatus,
  SocialNetworkProvider,
  SokoIdentityLinkSummary,
  UserIdentitySummary,
  UserSummary
} from "@soko/shared-types";
import { Cp2Error } from "../../cp2-error.js";
import {
  createContactDisplayHint,
  createContactHash,
  normalizeNetworkConnectionInput,
  normalizeSocialRelationship,
  providerDisplayName,
  sanitizeNetworkNode,
  type PhoneContactNetworkInput,
  type SocialProfileNetworkInput
} from "./shared.js";

export interface NetworkDomainDeps {
  requirePinVerifiedSession: (sessionId: string | null, now: Date) => AuthSessionView;
  accounts: Map<string, AccountSummary>;
  userByAccount: Map<string, string>;
  memberships: Map<string, MembershipSummary>;
  businesses: Map<string, BusinessSummary>;
  userIdentities: Map<string, UserIdentitySummary>;
}

export class NetworkDomain {
  private readonly networkNodes = new Map<string, NetworkNodeSummary>();
  private readonly networkEdges = new Map<string, NetworkEdgeSummary>();
  private readonly networkSources = new Map<string, NetworkSyncSourceSummary>();
  private readonly networkPermissions = new Map<string, NetworkPermissionSummary>();
  private readonly networkRoutes = new Map<string, AgentRouteSummary>();
  private readonly contactHashes = new Map<string, ContactHashSummary>();
  private readonly contactHashIdByValue = new Map<string, string>();
  private readonly externalIdentities = new Map<string, ExternalIdentitySummary>();
  private readonly externalIdentityIdBySubject = new Map<string, string>();
  private readonly sokoIdentityLinks = new Map<string, SokoIdentityLinkSummary>();

  constructor(private readonly deps: NetworkDomainDeps) {}

  get networkNodesMap(): Map<string, NetworkNodeSummary> {
    return this.networkNodes;
  }

  get networkEdgesMap(): Map<string, NetworkEdgeSummary> {
    return this.networkEdges;
  }

  get networkSourcesMap(): Map<string, NetworkSyncSourceSummary> {
    return this.networkSources;
  }

  get networkPermissionsMap(): Map<string, NetworkPermissionSummary> {
    return this.networkPermissions;
  }

  get networkRoutesMap(): Map<string, AgentRouteSummary> {
    return this.networkRoutes;
  }

  get contactHashesMap(): Map<string, ContactHashSummary> {
    return this.contactHashes;
  }

  get contactHashIdByValueMap(): Map<string, string> {
    return this.contactHashIdByValue;
  }

  get externalIdentitiesMap(): Map<string, ExternalIdentitySummary> {
    return this.externalIdentities;
  }

  get externalIdentityIdBySubjectMap(): Map<string, string> {
    return this.externalIdentityIdBySubject;
  }

  get sokoIdentityLinksMap(): Map<string, SokoIdentityLinkSummary> {
    return this.sokoIdentityLinks;
  }

  clear(): void {
    this.networkNodes.clear();
    this.networkEdges.clear();
    this.networkSources.clear();
    this.networkPermissions.clear();
    this.networkRoutes.clear();
    this.contactHashes.clear();
    this.contactHashIdByValue.clear();
    this.externalIdentities.clear();
    this.externalIdentityIdBySubject.clear();
    this.sokoIdentityLinks.clear();
  }

  rebuildDerivedIndexes(): void {
    this.contactHashIdByValue.clear();
    for (const item of this.contactHashes.values()) {
      this.contactHashIdByValue.set(
        `${item.ownerUserId}:${item.hashType}:${item.hashValue}`,
        item.id
      );
    }

    this.externalIdentityIdBySubject.clear();
    for (const item of this.externalIdentities.values()) {
      this.externalIdentityIdBySubject.set(
        `${item.ownerUserId}:${item.provider}:${item.providerSubjectHash}`,
        item.id
      );
    }
  }

  syncPhoneContacts(input: {
    sessionId: string | null;
    contacts: PhoneContactNetworkInput[];
    sourceName?: string;
    now?: Date;
  }): NetworkGraphSummary {
    const now = input.now ?? new Date();
    const session = this.deps.requirePinVerifiedSession(input.sessionId, now);
    const importedContacts = input.contacts.map((contact, index) =>
      normalizeNetworkConnectionInput(contact, `contacts.${index}`)
    );
    this.disconnectActiveNetworkSources(session.user.id, "phone", now);
    const source = this.createNetworkSource({
      ownerUserId: session.user.id,
      sourceType: "phone_contact",
      sourcePlatform: "phone",
      displayName: input.sourceName?.trim() || "Phone contacts",
      importedCount: importedContacts.length,
      now
    });
    const ownerNode = this.ensureOwnerNetworkNode(session.user, now);

    for (const contact of importedContacts) {
      const directNode = this.createImportedNetworkNode({
        ownerUserId: session.user.id,
        sourceId: source.id,
        sourceType: "phone_contact",
        sourcePlatform: "phone",
        displayName: contact.name,
        degree: 1,
        kind: "external_contact",
        phone: contact.phone,
        email: contact.email,
        now
      });
      this.createNetworkEdge({
        ownerUserId: session.user.id,
        sourceType: "phone_contact",
        sourcePlatform: "phone",
        fromNodeId: ownerNode.id,
        toNodeId: directNode.id,
        degree: 1,
        trustWeight: 0.8,
        interactionWeight: 0.3,
        visibilityStatus: "direct",
        consentStatus: "pending",
        now
      });

      for (const connection of contact.connections ?? []) {
        const normalizedConnection = normalizeNetworkConnectionInput(connection, "connection");
        const extendedNode = this.createImportedNetworkNode({
          ownerUserId: session.user.id,
          sourceId: source.id,
          sourceType: "phone_contact",
          sourcePlatform: "phone",
          displayName: normalizedConnection.name,
          degree: 2,
          kind: "external_contact",
          phone: null,
          email: null,
          now
        });
        this.createNetworkEdge({
          ownerUserId: session.user.id,
          sourceType: "agent_route",
          sourcePlatform: "phone",
          fromNodeId: directNode.id,
          toNodeId: extendedNode.id,
          degree: 2,
          trustWeight: 0.45,
          interactionWeight: 0.15,
          visibilityStatus: "agent_mediated",
          consentStatus: "agent_required",
          now
        });
      }
    }

    this.refreshNetworkSourceCounts(source.id, now);
    return this.getNetworkGraph({ sessionId: input.sessionId, now });
  }

  syncSocialNetwork(input: {
    sessionId: string | null;
    provider: SocialNetworkProvider;
    profiles: SocialProfileNetworkInput[];
    sourceName?: string;
    now?: Date;
  }): NetworkGraphSummary {
    const now = input.now ?? new Date();
    const session = this.deps.requirePinVerifiedSession(input.sessionId, now);
    const profiles = input.profiles.map((profile, index) =>
      normalizeNetworkConnectionInput(profile, `profiles.${index}`)
    );
    this.disconnectActiveNetworkSources(session.user.id, input.provider, now);
    const source = this.createNetworkSource({
      ownerUserId: session.user.id,
      sourceType: "social",
      sourcePlatform: input.provider,
      displayName: input.sourceName?.trim() || `${input.provider} connections`,
      importedCount: profiles.length,
      now
    });
    const ownerNode = this.ensureOwnerNetworkNode(session.user, now);

    for (const profile of profiles) {
      const relationship = normalizeSocialRelationship(profile.relationship);
      const directNode = this.createImportedNetworkNode({
        ownerUserId: session.user.id,
        sourceId: source.id,
        sourceType: "social",
        sourcePlatform: input.provider,
        displayName: profile.name,
        degree: 1,
        kind: "external_social",
        providerSubject: profile.providerSubject ?? profile.handle ?? profile.name,
        handle: profile.handle,
        now
      });
      this.createNetworkEdge({
        ownerUserId: session.user.id,
        sourceType:
          relationship === "interaction" || relationship === "message"
            ? "social_interaction"
            : "social_follow",
        sourcePlatform: input.provider,
        fromNodeId: ownerNode.id,
        toNodeId: directNode.id,
        degree: 1,
        trustWeight: relationship === "interaction" || relationship === "message" ? 0.7 : 0.55,
        interactionWeight:
          relationship === "interaction" || relationship === "message" ? 0.8 : 0.35,
        visibilityStatus: "direct",
        consentStatus: "pending",
        now
      });

      for (const connection of profile.connections ?? []) {
        const normalizedConnection = normalizeNetworkConnectionInput(connection, "connection");
        const extendedNode = this.createImportedNetworkNode({
          ownerUserId: session.user.id,
          sourceId: source.id,
          sourceType: "social",
          sourcePlatform: input.provider,
          displayName: normalizedConnection.name,
          degree: 2,
          kind: "external_social",
          providerSubject:
            normalizedConnection.providerSubject ??
            normalizedConnection.handle ??
            normalizedConnection.name,
          handle: normalizedConnection.handle,
          now
        });
        this.createNetworkEdge({
          ownerUserId: session.user.id,
          sourceType: "agent_route",
          sourcePlatform: input.provider,
          fromNodeId: directNode.id,
          toNodeId: extendedNode.id,
          degree: 2,
          trustWeight: 0.4,
          interactionWeight: 0.2,
          visibilityStatus: "agent_mediated",
          consentStatus: "agent_required",
          now
        });
      }
    }

    this.refreshNetworkSourceCounts(source.id, now);
    return this.getNetworkGraph({ sessionId: input.sessionId, now });
  }

  syncConnectedSocialProvider(input: {
    sessionId: string | null;
    provider: SocialNetworkProvider;
    now?: Date;
  }): NetworkGraphSummary {
    const now = input.now ?? new Date();
    const session = this.deps.requirePinVerifiedSession(input.sessionId, now);
    const identity = [...this.deps.userIdentities.values()].find(
      (candidate) =>
        candidate.accountId === session.account.id && candidate.provider === input.provider
    );

    if (identity === undefined) {
      throw new Cp2Error(
        409,
        "network_provider_not_connected",
        "Connect this provider to your Soko account before synchronizing it."
      );
    }

    return this.syncSocialNetwork({
      sessionId: input.sessionId,
      provider: input.provider,
      profiles: [],
      sourceName: `${providerDisplayName(identity.provider)} network`,
      now
    });
  }

  getNetworkGraph(input: { sessionId: string | null; now?: Date }): NetworkGraphSummary {
    const now = input.now ?? new Date();
    const session = this.deps.requirePinVerifiedSession(input.sessionId, now);
    this.ensureOwnerNetworkNode(session.user, now);
    return this.networkGraphForUser(session.user.id, now);
  }

  getDirectNetwork(input: { sessionId: string | null; now?: Date }): NetworkNodeSummary[] {
    return this.getNetworkGraph(input).nodes.filter((node) => node.degree === 1);
  }

  getExtendedNetwork(input: { sessionId: string | null; now?: Date }): NetworkNodeSummary[] {
    return this.getNetworkGraph(input).nodes.filter((node) => node.degree === 2);
  }

  createAgentRoute(input: {
    sessionId: string | null;
    requestText: string;
    targetNodeId?: string | null;
    now?: Date;
  }): AgentRouteSummary {
    const now = input.now ?? new Date();
    const session = this.deps.requirePinVerifiedSession(input.sessionId, now);
    const targetNode = this.findAgentRouteTarget({
      ownerUserId: session.user.id,
      requestText: input.requestText,
      targetNodeId: input.targetNodeId ?? null
    });
    const directEdge = [...this.networkEdges.values()].find(
      (edge) =>
        edge.ownerUserId === session.user.id && edge.toNodeId === targetNode.id && edge.degree === 2
    );

    if (directEdge === undefined) {
      throw new Cp2Error(
        409,
        "network_route_requires_agent",
        "Only second-degree network nodes require agent-mediated routes."
      );
    }

    const directNode = this.requireNetworkNode(directEdge.fromNodeId, session.user.id);
    const permission: NetworkPermissionSummary = {
      id: randomUUID(),
      ownerUserId: session.user.id,
      routeId: "",
      fromNodeId: directNode.id,
      toNodeId: targetNode.id,
      status: "agent_required",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
    const route: AgentRouteSummary = {
      id: randomUUID(),
      ownerUserId: session.user.id,
      requestText: input.requestText.trim(),
      status: "pending_permission",
      directNodeId: directNode.id,
      targetNodeId: targetNode.id,
      viaAgentLabel: `${directNode.displayName}'s Agent`,
      path: [
        "You",
        directNode.displayName,
        `${directNode.displayName}'s Agent`,
        targetNode.displayName
      ],
      permissionId: permission.id,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
    this.networkPermissions.set(permission.id, {
      ...permission,
      routeId: route.id
    });
    this.networkRoutes.set(route.id, route);
    return route;
  }

  getAgentRoute(input: {
    sessionId: string | null;
    routeId: string;
    now?: Date;
  }): AgentRouteSummary {
    const now = input.now ?? new Date();
    const session = this.deps.requirePinVerifiedSession(input.sessionId, now);
    const route = this.networkRoutes.get(input.routeId);

    if (route === undefined || route.ownerUserId !== session.user.id) {
      throw new Cp2Error(404, "network_route_not_found", "Network route was not found.");
    }

    return route;
  }

  approveAgentRoute(input: {
    sessionId: string | null;
    routeId: string;
    now?: Date;
  }): AgentRouteSummary {
    return this.updateAgentRouteStatus(input, "approved", "granted");
  }

  rejectAgentRoute(input: {
    sessionId: string | null;
    routeId: string;
    now?: Date;
  }): AgentRouteSummary {
    return this.updateAgentRouteStatus(input, "rejected", "rejected");
  }

  deleteNetworkSource(input: {
    sessionId: string | null;
    sourceId: string;
    now?: Date;
  }): NetworkGraphSummary {
    const now = input.now ?? new Date();
    const session = this.deps.requirePinVerifiedSession(input.sessionId, now);
    const source = this.networkSources.get(input.sourceId);

    if (source === undefined || source.ownerUserId !== session.user.id) {
      throw new Cp2Error(404, "network_source_not_found", "Network sync source was not found.");
    }

    this.disconnectNetworkSourceRecord(source, now);

    return this.networkGraphForUser(session.user.id, now);
  }

  requirePhonebookNode(ownerUserId: string, networkNodeId: string): NetworkNodeSummary {
    const node = this.networkNodes.get(networkNodeId);

    if (
      node === undefined ||
      node.ownerUserId !== ownerUserId ||
      node.sourceType !== "phone_contact"
    ) {
      throw new Cp2Error(404, "phonebook_contact_not_found", "Phonebook contact was not found.");
    }

    return node;
  }

  private ensureOwnerNetworkNode(user: UserSummary, now: Date): NetworkNodeSummary {
    const existing = [...this.networkNodes.values()].find(
      (node) => node.ownerUserId === user.id && node.degree === 0
    );

    if (existing !== undefined) {
      return existing;
    }

    const node: NetworkNodeSummary = {
      id: randomUUID(),
      ownerUserId: user.id,
      kind: "soko_user",
      displayName: user.displayName,
      degree: 0,
      sourceId: null,
      sourceType: "owner",
      sourcePlatform: null,
      sokoUserId: user.id,
      sokoBusinessId: null,
      sokoAgentId: null,
      contactHashIds: [],
      externalIdentityId: null,
      visibilityStatus: "direct",
      consentStatus: "granted",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
    this.networkNodes.set(node.id, node);
    return node;
  }

  private createNetworkSource(input: {
    ownerUserId: string;
    sourceType: "phone_contact" | "social";
    sourcePlatform: "phone" | SocialNetworkProvider;
    displayName: string;
    importedCount: number;
    now: Date;
  }): NetworkSyncSourceSummary {
    const common = {
      id: randomUUID(),
      ownerUserId: input.ownerUserId,
      displayName: input.displayName,
      importedCount: input.importedCount,
      directCount: 0,
      extendedCount: 0,
      status: "active" as const,
      createdAt: input.now.toISOString(),
      updatedAt: input.now.toISOString(),
      disconnectedAt: null
    };
    const source: NetworkSyncSourceSummary =
      input.sourceType === "phone_contact"
        ? {
            ...common,
            sourceType: "phone_contact",
            sourcePlatform: "phone"
          }
        : {
            ...common,
            sourceType: "social",
            sourcePlatform: input.sourcePlatform as SocialNetworkProvider
          };
    this.networkSources.set(source.id, source);
    return source;
  }

  private disconnectActiveNetworkSources(
    ownerUserId: string,
    sourcePlatform: "phone" | SocialNetworkProvider,
    now: Date
  ): void {
    for (const source of this.networkSources.values()) {
      if (
        source.ownerUserId === ownerUserId &&
        source.sourcePlatform === sourcePlatform &&
        source.status === "active"
      ) {
        this.disconnectNetworkSourceRecord(source, now);
      }
    }
  }

  private disconnectNetworkSourceRecord(source: NetworkSyncSourceSummary, now: Date): void {
    this.networkSources.set(source.id, {
      ...source,
      status: "disconnected",
      updatedAt: now.toISOString(),
      disconnectedAt: now.toISOString()
    } as NetworkSyncSourceSummary);

    const nodeIds = new Set(
      [...this.networkNodes.values()]
        .filter((node) => node.ownerUserId === source.ownerUserId && node.sourceId === source.id)
        .map((node) => node.id)
    );

    for (const edge of [...this.networkEdges.values()]) {
      if (
        edge.ownerUserId === source.ownerUserId &&
        (nodeIds.has(edge.fromNodeId) || nodeIds.has(edge.toNodeId))
      ) {
        this.networkEdges.delete(edge.id);
      }
    }

    for (const route of [...this.networkRoutes.values()]) {
      if (
        route.ownerUserId === source.ownerUserId &&
        (nodeIds.has(route.directNodeId) || nodeIds.has(route.targetNodeId))
      ) {
        this.networkRoutes.delete(route.id);
        this.networkPermissions.delete(route.permissionId);
      }
    }

    for (const [id, link] of this.sokoIdentityLinks.entries()) {
      if (link.ownerUserId === source.ownerUserId && nodeIds.has(link.nodeId)) {
        this.sokoIdentityLinks.delete(id);
      }
    }

    for (const nodeId of nodeIds) {
      this.networkNodes.delete(nodeId);
    }
  }

  private createImportedNetworkNode(input: {
    ownerUserId: string;
    sourceId: string;
    sourceType: "phone_contact" | "social";
    sourcePlatform: string;
    displayName: string;
    degree: 1 | 2;
    kind: "external_contact" | "external_social";
    phone?: string | null | undefined;
    email?: string | null | undefined;
    providerSubject?: string | null | undefined;
    handle?: string | null | undefined;
    now: Date;
  }): NetworkNodeSummary {
    const contactHashIds: string[] = [];

    if (input.degree === 1) {
      if (input.phone !== undefined && input.phone !== null) {
        contactHashIds.push(
          this.ensureContactHash({
            ownerUserId: input.ownerUserId,
            hashType: "phone",
            rawValue: input.phone,
            now: input.now
          }).id
        );
      }

      if (input.email !== undefined && input.email !== null) {
        contactHashIds.push(
          this.ensureContactHash({
            ownerUserId: input.ownerUserId,
            hashType: "email",
            rawValue: input.email,
            now: input.now
          }).id
        );
      }
    }

    const externalIdentityId =
      input.kind === "external_social"
        ? this.ensureExternalIdentity({
            ownerUserId: input.ownerUserId,
            provider: input.sourcePlatform,
            providerSubject: input.providerSubject ?? input.displayName,
            displayName: input.displayName,
            handle: input.handle ?? null,
            now: input.now
          }).id
        : null;
    const sokoLink = this.findSokoIdentityLink({
      ownerUserId: input.ownerUserId,
      contactHashIds,
      now: input.now
    });
    const node: NetworkNodeSummary = {
      id: randomUUID(),
      ownerUserId: input.ownerUserId,
      kind: sokoLink === null ? input.kind : "soko_user",
      displayName: input.displayName,
      degree: input.degree,
      sourceId: input.sourceId,
      sourceType: input.sourceType,
      sourcePlatform: input.sourcePlatform,
      sokoUserId: sokoLink?.linkedUserId ?? null,
      sokoBusinessId: sokoLink?.linkedBusinessId ?? null,
      sokoAgentId: sokoLink?.linkedAgentId ?? null,
      contactHashIds,
      externalIdentityId,
      visibilityStatus: input.degree === 1 ? "direct" : "agent_mediated",
      consentStatus: input.degree === 1 ? "pending" : "agent_required",
      createdAt: input.now.toISOString(),
      updatedAt: input.now.toISOString()
    };
    this.networkNodes.set(node.id, node);

    if (sokoLink !== null) {
      this.sokoIdentityLinks.set(sokoLink.id, {
        ...sokoLink,
        nodeId: node.id
      });
    }

    return node;
  }

  private createNetworkEdge(input: {
    ownerUserId: string;
    sourceType: NetworkEdgeSourceType;
    sourcePlatform: string | null;
    fromNodeId: string;
    toNodeId: string;
    degree: 1 | 2;
    trustWeight: number;
    interactionWeight: number;
    visibilityStatus: NetworkVisibilityStatus;
    consentStatus: NetworkConsentStatus;
    now: Date;
  }): NetworkEdgeSummary {
    const edge: NetworkEdgeSummary = {
      id: randomUUID(),
      ownerUserId: input.ownerUserId,
      sourceType: input.sourceType,
      sourcePlatform: input.sourcePlatform,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      degree: input.degree,
      trustWeight: input.trustWeight,
      interactionWeight: input.interactionWeight,
      visibilityStatus: input.visibilityStatus,
      consentStatus: input.consentStatus,
      createdAt: input.now.toISOString(),
      updatedAt: input.now.toISOString()
    };
    this.networkEdges.set(edge.id, edge);
    return edge;
  }

  private ensureContactHash(input: {
    ownerUserId: string;
    hashType: "phone" | "email" | "social";
    rawValue: string;
    now: Date;
  }): ContactHashSummary {
    const hashValue = createContactHash(input.hashType, input.rawValue);
    const mapKey = `${input.ownerUserId}:${input.hashType}:${hashValue}`;
    const existingId = this.contactHashIdByValue.get(mapKey);

    if (existingId !== undefined) {
      return this.contactHashes.get(existingId)!;
    }

    const contactHash: ContactHashSummary = {
      id: randomUUID(),
      ownerUserId: input.ownerUserId,
      hashType: input.hashType,
      hashValue,
      displayHint: createContactDisplayHint(input.rawValue),
      createdAt: input.now.toISOString()
    };
    this.contactHashes.set(contactHash.id, contactHash);
    this.contactHashIdByValue.set(mapKey, contactHash.id);
    return contactHash;
  }

  private ensureExternalIdentity(input: {
    ownerUserId: string;
    provider: string;
    providerSubject: string;
    displayName: string;
    handle: string | null;
    now: Date;
  }): ExternalIdentitySummary {
    const providerSubjectHash = createContactHash(
      "social",
      `${input.provider}:${input.providerSubject}`
    );
    const mapKey = `${input.ownerUserId}:${input.provider}:${providerSubjectHash}`;
    const existingId = this.externalIdentityIdBySubject.get(mapKey);

    if (existingId !== undefined) {
      return this.externalIdentities.get(existingId)!;
    }

    const identity: ExternalIdentitySummary = {
      id: randomUUID(),
      ownerUserId: input.ownerUserId,
      provider: input.provider,
      providerSubjectHash,
      displayName: input.displayName,
      handle: input.handle,
      createdAt: input.now.toISOString()
    };
    this.externalIdentities.set(identity.id, identity);
    this.externalIdentityIdBySubject.set(mapKey, identity.id);
    return identity;
  }

  private findSokoIdentityLink(input: {
    ownerUserId: string;
    contactHashIds: string[];
    now: Date;
  }): SokoIdentityLinkSummary | null {
    for (const hashId of input.contactHashIds) {
      const contactHash = this.contactHashes.get(hashId);

      if (contactHash === undefined) {
        continue;
      }

      const channel = contactHash.hashType === "email" ? "email" : "phone";
      const matchingAccount = [...this.deps.accounts.values()].find((account) => {
        if (account.primaryAuthChannel !== channel) return false;
        return createContactHash(channel, account.primaryAuthDestination) === contactHash.hashValue;
      });

      if (matchingAccount === undefined) {
        continue;
      }

      const linkedUserId = this.deps.userByAccount.get(matchingAccount.id) ?? null;
      const linkedBusiness = [...this.deps.memberships.values()]
        .filter((membership) => membership.userId === linkedUserId)
        .map((membership) => this.deps.businesses.get(membership.businessId))
        .find((business): business is BusinessSummary => business !== undefined);

      return {
        id: randomUUID(),
        ownerUserId: input.ownerUserId,
        nodeId: "",
        linkedUserId,
        linkedBusinessId: linkedBusiness?.id ?? null,
        linkedAgentId: linkedBusiness?.sokoId ?? null,
        confidence: 0.95,
        createdAt: input.now.toISOString()
      };
    }

    return null;
  }

  private refreshNetworkSourceCounts(sourceId: string, now: Date): void {
    const source = this.networkSources.get(sourceId);

    if (source === undefined) {
      return;
    }

    const nodes = [...this.networkNodes.values()].filter((node) => node.sourceId === sourceId);
    this.networkSources.set(sourceId, {
      ...source,
      directCount: nodes.filter((node) => node.degree === 1).length,
      extendedCount: nodes.filter((node) => node.degree === 2).length,
      updatedAt: now.toISOString()
    } as NetworkSyncSourceSummary);
  }

  private networkGraphForUser(ownerUserId: string, now: Date): NetworkGraphSummary {
    return {
      ownerUserId,
      generatedAt: now.toISOString(),
      nodes: [...this.networkNodes.values()]
        .filter((node) => node.ownerUserId === ownerUserId)
        .map(sanitizeNetworkNode)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      edges: [...this.networkEdges.values()]
        .filter((edge) => edge.ownerUserId === ownerUserId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      sources: [...this.networkSources.values()]
        .filter((source) => source.ownerUserId === ownerUserId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      routes: [...this.networkRoutes.values()]
        .filter((route) => route.ownerUserId === ownerUserId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      permissions: [...this.networkPermissions.values()]
        .filter((permission) => permission.ownerUserId === ownerUserId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      identityLinks: [...this.sokoIdentityLinks.values()]
        .filter((link) => link.ownerUserId === ownerUserId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    };
  }

  private findAgentRouteTarget(input: {
    ownerUserId: string;
    requestText: string;
    targetNodeId: string | null;
  }): NetworkNodeSummary {
    const extendedNodes = [...this.networkNodes.values()].filter(
      (node) => node.ownerUserId === input.ownerUserId && node.degree === 2
    );
    const target =
      input.targetNodeId === null
        ? (extendedNodes.find((node) =>
            input.requestText.toLowerCase().includes(node.displayName.toLowerCase())
          ) ?? extendedNodes[0])
        : extendedNodes.find((node) => node.id === input.targetNodeId);

    if (target === undefined) {
      throw new Cp2Error(
        404,
        "network_target_not_found",
        "No reachable second-degree network target was found."
      );
    }

    return target;
  }

  private requireNetworkNode(nodeId: string, ownerUserId: string): NetworkNodeSummary {
    const node = this.networkNodes.get(nodeId);

    if (node === undefined || node.ownerUserId !== ownerUserId) {
      throw new Cp2Error(404, "network_node_not_found", "Network node was not found.");
    }

    return node;
  }

  private updateAgentRouteStatus(
    input: {
      sessionId: string | null;
      routeId: string;
      now?: Date;
    },
    status: AgentRouteSummary["status"],
    permissionStatus: NetworkConsentStatus
  ): AgentRouteSummary {
    const now = input.now ?? new Date();
    const route = this.getAgentRoute({ ...input, now });
    const updatedRoute: AgentRouteSummary = {
      ...route,
      status,
      updatedAt: now.toISOString()
    };
    const permission = this.networkPermissions.get(route.permissionId);

    if (permission !== undefined) {
      this.networkPermissions.set(permission.id, {
        ...permission,
        status: permissionStatus,
        updatedAt: now.toISOString()
      });
    }

    this.networkRoutes.set(route.id, updatedRoute);
    return updatedRoute;
  }
}
