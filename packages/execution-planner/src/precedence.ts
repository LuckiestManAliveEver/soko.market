import type { ModelPreferenceCandidate, PrecedenceInput, PrecedenceLevel } from "./types.js";

/**
 * Fixed precedence, implemented once, centrally: request override beats conversation override
 * beats agent default beats user default beats system default. `system` is the only mandatory
 * level (every other level is `| null`, meaning "nothing set here, fall through"), so this
 * function always returns a result - there is no "no preference resolved" case.
 *
 * Determinism requirement: for the same `input`, this always returns the same
 * { preference, level } pair - no randomness, no time-of-day dependence, no I/O.
 */
export function resolveModelPreference(input: PrecedenceInput): {
  preference: ModelPreferenceCandidate;
  level: PrecedenceLevel;
} {
  if (input.request !== null) return { preference: input.request, level: "request" };
  if (input.conversation !== null) return { preference: input.conversation, level: "conversation" };
  if (input.agent !== null) return { preference: input.agent, level: "agent" };
  if (input.user !== null) return { preference: input.user, level: "user" };
  return { preference: input.system, level: "system" };
}
