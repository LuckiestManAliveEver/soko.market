# Network Sync Graph PRD

## Objective

Build Soko's network engine so contact and social sync create a trusted commerce graph instead of a plain address book import.

## Goals

- Create a direct phone network from synced contacts.
- Create a direct social network from connected provider data.
- Model second-degree contacts as reachable only through direct friends' agents.
- Protect private identifiers with hashing and limited visibility.
- Let users disconnect sync sources and delete imported network data.
- Expose the graph through API routes, agent behavior, and a mobile-first Network card.

## Network Layers

1. Direct phone network
   - Imported contacts become direct network nodes.
   - Existing Soko users, shops, or agents are linked where possible.
   - External contacts are stored with hashed identifiers when phone or email data is present.

2. Direct social network
   - Provider imports can include followed accounts, followers, interactions, and message contacts when a provider allows it.
   - Provider-specific details are contained behind a source abstraction.

3. Second-degree network
   - Friends of direct phone contacts and social connections are modeled as extended nodes.
   - Access is represented as a path through a direct friend's agent.
   - Private identifiers are never exposed for second-degree nodes.

4. Agent-mediated reach
   - Requests to second-degree people or shops create an AgentRoute.
   - The direct friend's agent can forward, suggest, block, request permission, approve, or reject.

## Data Model

- NetworkNode
- NetworkEdge
- ContactSyncSource
- SocialSyncSource
- AgentRoute
- NetworkPermission
- ContactHash
- ExternalIdentity
- SokoIdentityLink

Each edge stores ownerUserId, sourceType, sourcePlatform, fromNodeId, toNodeId, degree, trustWeight, interactionWeight, visibilityStatus, consentStatus, createdAt, and updatedAt.

## API

- `POST /network/sync/contacts`
- `POST /network/sync/social/:provider`
- `GET /network`
- `GET /network/direct`
- `GET /network/extended`
- `POST /network/routes`
- `GET /network/routes/:id`
- `POST /network/routes/:id/approve`
- `POST /network/routes/:id/reject`
- `DELETE /network/sources/:id`

## UX

- During signup, explain that synced contacts build the first commerce network.
- Social account connection explains that friends-of-friends can be reached through friends' agents.
- In the app, a Network card shows direct contacts, social connections, reachable extended nodes, and the mutual path.
- Second-degree private details remain hidden.

## Agent Behavior

When users ask for suppliers, customers, shops, or products through their network, the agent searches direct network first, then second-degree reachable nodes. Second-degree results create an AgentRoute and show the path and permission state.

## Privacy And Security

- Hash phone numbers and emails for matching.
- Do not expose raw identifiers for second-degree nodes.
- Imported contacts are not messaged automatically.
- Users can disconnect sync sources and delete imported network data.

## Acceptance Criteria

- Phone sync creates direct network nodes and edges.
- Social sync creates direct social nodes through a provider-neutral interface.
- Second-degree nodes are reachable only through agent-mediated paths.
- Route approval and rejection update permission state.
- Deleting a sync source removes its imported network edges and unlinked nodes.
- Tests cover hashing, graph creation, routing, permission enforcement, source deletion, and raw identifier leakage.
