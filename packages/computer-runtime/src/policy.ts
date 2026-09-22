/**
 * Pure, deterministic computer-action policy: classification (READ/MUTATE/CONSEQUENTIAL/BLOCKED),
 * navigation/SSRF domain policy, and approval-binding hashing. No I/O, no provider knowledge - the
 * CP2 domain (services/api/src/cp2/domains/computer-runtime) is the only caller and is responsible
 * for acting on the result (creating an approval, rejecting a call, forwarding to the provider).
 *
 * Task brief §9/§14: classification must consider semantic intent, target, and page context, not
 * just which generic tool name (click/type/upload) carried the call - a model cannot get a
 * consequential action past approval by "representing it as a generic click".
 */
import { createHash } from "node:crypto";

import type { ComputerActionClass, ComputerTarget } from "./types.js";

/** Keyword heuristics for consequential intent, matched against the target element's own
 *  description/name/role - never against the agent's self-reported intent alone, since a model
 *  claiming "this is just a read" about a submit button must not be trusted on its own word. */
const CONSEQUENTIAL_TARGET_PATTERNS: RegExp[] = [
  /\bsend\b/iu,
  /\bpost\b/iu,
  /\bpublish\b/iu,
  /\bsubmit\b/iu,
  /\bplace\s*order\b/iu,
  /\bbuy(\s*now)?\b/iu,
  /\bcheckout\b/iu,
  /\bpay(\s*now)?\b/iu,
  /\bconfirm\s*(order|purchase|payment)\b/iu,
  /\bdelete\b/iu,
  /\bremove\b/iu,
  /\bunsubscribe\b/iu,
  /\btransfer\b/iu,
  /\bwithdraw\b/iu,
  /\bchange\s*(password|email|phone)\b/iu,
  /\bdeactivate\b/iu,
  /\bcancel\s*(subscription|account)\b/iu,
  /\baccept\s*(terms|invite|request)\b/iu,
  /\bfollow\b/iu
];

/** Field descriptors the agent must never type into, regardless of classification - credentials
 *  never flow through the model (task brief §8/§27). This is a hard BLOCKED, not an approval gate. */
const SENSITIVE_FIELD_PATTERNS: RegExp[] = [
  /password/iu,
  /passcode/iu,
  /\bpin\b/iu,
  /\botp\b/iu,
  /one[\s-]?time[\s-]?code/iu,
  /security\s*code/iu,
  /\bcvv\b|\bcvc\b/iu,
  /card\s*number/iu,
  /\biban\b/iu,
  /social\s*security/iu,
  /\bssn\b/iu,
  /recovery\s*key/iu,
  /seed\s*phrase/iu,
  /private\s*key/iu
];

export interface ClassifyComputerActionInput {
  toolName: string;
  target?: ComputerTarget | undefined;
  /** The agent's own claimed intent label, e.g. "SEND_MESSAGE" - advisory only, never sufficient
   *  on its own to either force or avoid CONSEQUENTIAL classification. */
  claimedIntent?: string | undefined;
  /** True when the target element was already flagged sensitive by the last observation
   *  (ComputerInteractiveElement.sensitive). */
  targetSensitive?: boolean | undefined;
  submit?: boolean | undefined;
}

export function classifyComputerAction(input: ClassifyComputerActionInput): ComputerActionClass {
  if (input.targetSensitive === true) return "BLOCKED";

  const descriptor = [input.target?.description, input.claimedIntent].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );

  if (descriptor.some((text) => SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(text)))) {
    return "BLOCKED";
  }

  const isMutatingVerb =
    input.toolName === "computer.click" ||
    input.toolName === "computer.upload" ||
    (input.toolName === "computer.type" && input.submit === true);

  if (!isMutatingVerb) {
    // navigate/observe/scroll/type-without-submit are READ or benign MUTATE, never gated.
    return input.toolName === "computer.type" ? "MUTATE" : "READ";
  }

  if (
    descriptor.some((text) => CONSEQUENTIAL_TARGET_PATTERNS.some((pattern) => pattern.test(text)))
  ) {
    return "CONSEQUENTIAL";
  }

  return "MUTATE";
}

export interface NavigationPolicyOptions {
  allowedDomains?: string[];
  blockedDomains?: string[];
}

export type NavigationPolicyDecision = { allowed: true } | { allowed: false; reason: string };

const PRIVATE_NETWORK_HOST_PATTERNS: RegExp[] = [
  /^localhost$/iu,
  /^127\./u,
  /^0\.0\.0\.0$/u,
  /^10\./u,
  /^192\.168\./u,
  /^172\.(1[6-9]|2\d|3[0-1])\./u,
  /^169\.254\./u, // link-local, includes cloud metadata endpoints (169.254.169.254)
  /^::1$/u,
  /^fc00:/iu,
  /^fe80:/iu,
  /\.local$/iu,
  /\.internal$/iu
];

/**
 * Defense-in-depth navigation/SSRF policy. Must be enforced both here (services/api, before a
 * navigate call is forwarded) and independently inside the isolated worker process
 * (services/computer-worker), per computer-runtime-audit.md §7 - a compromised or buggy worker
 * response must never be the only line of defense.
 */
export function evaluateNavigationPolicy(
  rawUrl: string,
  options: NavigationPolicyOptions = {}
): NavigationPolicyDecision {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: "Not a valid absolute URL." };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { allowed: false, reason: `Protocol ${url.protocol} is not permitted.` };
  }

  const hostname = url.hostname.toLowerCase();
  if (PRIVATE_NETWORK_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) {
    return {
      allowed: false,
      reason: "Navigation to private/internal network addresses is blocked."
    };
  }

  if (options.blockedDomains?.some((domain) => matchesDomain(hostname, domain)) === true) {
    return { allowed: false, reason: `${hostname} is on the blocked-domains list.` };
  }

  if (
    options.allowedDomains !== undefined &&
    options.allowedDomains.length > 0 &&
    !options.allowedDomains.some((domain) => matchesDomain(hostname, domain))
  ) {
    return { allowed: false, reason: `${hostname} is not on the allowed-domains list.` };
  }

  return { allowed: true };
}

function matchesDomain(hostname: string, domain: string): boolean {
  const normalized = domain.toLowerCase().replace(/^\*\./u, "");
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

/** Strips volatile fields (nothing here is ever a timestamp/nonce today, but this keeps the hash
 *  stable if the action shape grows one) and produces a deterministic JSON string for hashing. */
export function canonicalizeComputerAction(
  toolName: string,
  sessionId: string,
  action: Record<string, unknown>
): string {
  const sortedKeys = Object.keys(action).sort();
  const canonical: Record<string, unknown> = {};
  for (const key of sortedKeys) canonical[key] = action[key];
  return JSON.stringify({ toolName, sessionId, action: canonical });
}

/** Binds an approval to the exact proposed action - task brief §10: "Changing recipient/content
 *  after approval invalidates the approval." The CP2 domain stores both the canonical action and
 *  this hash; approval execution re-derives the hash from the stored action (never from
 *  client-resent input) so there is nothing for a client to replay a changed action toward. */
export function hashComputerAction(canonicalAction: string): string {
  return createHash("sha256").update(canonicalAction).digest("hex");
}
