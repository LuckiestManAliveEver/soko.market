# CP11 Decision Log

Status: passed
Date opened: 2026-07-04
Date passed: 2026-07-04

This file records llama.cpp local model adapter decisions for CP11.

## Accepted Decisions

| ID       | Decision                                                                   | Rationale                                                                                         | Impact                                                                                                   |
| -------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| CP11-D01 | Keep the local model behind the CP10 runtime contract.                     | CP10 already defines planning, verification, confirmation, and deterministic mutation boundaries. | The adapter can improve language handling without becoming a business data authority.                    |
| CP11-D02 | Treat local model inference as optional and fail-closed.                   | Local model availability depends on developer machine setup, model files, and runtime resources.  | Unavailable, slow, or invalid inference must fall back to deterministic CP10 behavior.                   |
| CP11-D03 | Do not automate model download or quantization in CP11.                    | Model licensing, size, storage, and hardware constraints require explicit operator choice.        | CP11 documents configuration but does not fetch model artifacts.                                         |
| CP11-D04 | Avoid plaintext prompt and output telemetry.                               | Prompts can contain merchant context and user-entered business data.                              | Telemetry records adapter state, timing, fallback decisions, and error codes rather than raw text.       |
| CP11-D05 | Parse model output into bounded runtime shapes before verification.        | Free-form model text must not directly trigger business mutations.                                | Model output can only become response text, clarification, or draft plan input to existing verification. |
| CP11-D06 | Preserve CP4 parser fallback and CP10 verification semantics.              | Existing deterministic behavior is the stable safety baseline.                                    | CP11 must not weaken parser fallback, risk gates, confirmation tokens, or deterministic validators.      |
| CP11-D07 | Keep performance work limited to timeouts and configuration in this phase. | CP11 should prove the adapter boundary before optimizing hardware-specific inference.             | Benchmark tuning, GPU configuration, and quantization work remain deferred.                              |

## Deferred Decisions

| Decision                               | Deferred To | Reason                                                                                  |
| -------------------------------------- | ----------- | --------------------------------------------------------------------------------------- |
| Model download and artifact management | CP12+       | Needs licensing, storage, checksums, and operator consent decisions.                    |
| Quantization and hardware tuning       | CP12+       | Requires real target hardware and benchmark criteria.                                   |
| Production hosted LLM provider         | CP14/CP15   | Provider choice requires security, privacy, cost, and compliance hardening.             |
| Model-assisted document extraction     | CP14/CP15   | Extraction accuracy and privacy need stronger controls beyond CP11 adapter wiring.      |
| Autonomous background agents           | CP15+       | Requires mature observability, permissions, rollback tooling, and operational controls. |
| Marketplace automation through tools   | CP17        | Marketplace workflows belong to the post-launch marketplace checkpoint.                 |
| Trusted Identity Execution Layer       | CP18        | TIEL belongs after core-commerce and runtime boundaries are hardened.                   |

## CP11 Boundary Checks

CP11 must preserve these checks:

- Local model output cannot directly mutate business records.
- Tool execution still routes through deterministic validators.
- High and critical risk tools still require confirmation.
- Verification blocks invalid role, risk, or tool-input states.
- Adapter prompts use business-scoped, least-necessary context.
- Adapter failures, timeouts, and malformed output fall back deterministically.
- Runtime telemetry avoids plaintext prompts, outputs, and sensitive merchant records.
- CP4 deterministic parser behavior remains available.
- CP10 runtime sessions, turns, verification, telemetry, and rate limits remain intact.
- Existing CP1 through CP10 tests continue to pass.
