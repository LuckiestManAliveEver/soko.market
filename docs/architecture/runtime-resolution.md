# Runtime resolution

The API's existing native runtime binding resolver is the authoritative server-side path. It uses
the persisted conversation binding, agent, binding-model roles, installations, hosts, legacy
binding compatibility, and adapter availability. Client routing may propose a previously
authorized local completion; it cannot invent a model, host, assignment, or tool permission.

For an ordinary connected turn:

1. Authorize the session, account membership, shop, and conversation.
2. Preserve an explicit active binding. `LOCAL_ONLY` is the only policy that forbids hosted
   provisioning.
3. If the conversation has no usable backend candidate, probe configured generic backend adapters.
4. Idempotently create or extend the shop/account binding with verified candidates.
5. Discover the binding's primary and ordered fallback roles.
6. Reject inactive models, unavailable installations, unhealthy hosts, incompatible runtime
   contracts, missing model capabilities, and cross-account/shop hosts.
7. Select the first available candidate deterministically by role and priority.
8. Resolve the execution target from the selected host, with migrated model configuration and the
   legacy binding as compatibility fallbacks.
9. Execute through the provider-neutral `ModelRuntimeAdapter` interface.
10. On a retryable, pre-side-effect inference failure, add the candidate key to the attempted set
    and try the next candidate. The persisted finite role list bounds failover.
11. Execute tools only after normal server parsing, authorization, confirmation, and idempotency
    checks.

Selection and completion telemetry records binding, conversation, model, target, host, resolution
source, fallback index/reason, error category, and latency. It excludes prompts, message contents,
credentials, and tokens.

Legacy `AgentModelBindingSummary` records and `conversation.runtime_binding_id` remain supported.
Migration 063 introduced the native graph; migrations 065–070 migrated the retired fabric,
provider-specific target values, and zero-setup tenant defaults without invalidating conversations.
