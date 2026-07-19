# Shop-owner inference node

Owner-node inference lets an authenticated owner's device process requests for that owner's shop.
Render is only the authenticated relay.

## Protocol

1. The owner opens `/v1/inference/owner-node` with the normal authenticated session and an allowed
   origin.
2. The device registers its node ID, tenant ID, agent IDs, supported model IDs, and concurrency.
3. The API verifies that the session belongs to the tenant and stores presence in the ephemeral
   broker.
4. An authenticated client posts a typed request to `/v1/inference/owner-node/jobs`.
5. The broker selects only a same-tenant, compatible, healthy-capacity node.
6. The node receives a job with an HMAC-signed token and expiry.
7. It returns monotonically sequenced chunks bearing the token.
8. The broker validates tenant, node, user, request, model, runtime, expiry, and replay before
   relaying NDJSON chunks.
9. Disconnect or expiry ends the job with a recoverable unavailable/timeout state.

Raw prompts are held only for the lifetime of an in-flight in-memory job and are not written to
PostgreSQL or Redis by the broker. Tokens, credentials, and prompt content are excluded from
structured logs.

## Rollout and scaling

The feature is off by default and requires `INFERENCE_OWNER_NODE_ENABLED=true` plus a 32-character
or longer `INFERENCE_JOB_SIGNING_SECRET`. The current broker is process-local and therefore valid
only for one API instance. Before enabling multiple Render instances, implement the same broker
contract over authenticated Redis pub/sub with TTL presence and jobs. Do not create a PostgreSQL
heartbeat row.

Registration is bounded per user, concurrency is capped, heartbeats expire, duplicate request IDs
are rejected, and chunk sequence numbers prevent replay. Edge rate limiting should additionally be
configured at the Render/CDN boundary for the WebSocket and job endpoint.
