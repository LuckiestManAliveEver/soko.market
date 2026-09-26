import { BlockList, isIP } from "node:net";

import { InferenceError } from "./errors.js";

/**
 * SSRF policy for provider base URLs (docs/architecture/multi-provider-inference-implementation.md
 * §11). Two layers:
 *
 * 1. validateProviderEndpoint() - static checks on the URL string, run when a provider or a BYOK
 *    custom endpoint is configured *and* again before every request: scheme, embedded credentials,
 *    port, known internal/metadata hostnames, and literal IPs in blocked ranges.
 * 2. assertPublicAddress() - run against every address DNS returns, *at connect time*, from the
 *    pinned lookup in http-transport.ts. Checking at connect time (rather than resolving once and
 *    then letting fetch resolve again) closes the DNS-rebinding gap.
 *
 * Redirects are never followed (http-transport.ts), so a public endpoint cannot bounce a request
 * to 169.254.169.254 either.
 *
 * `allowPrivateNetwork` exists only for operator-configured, environment-managed providers (e.g. a
 * llama.cpp server on a private network next to the API). It is never settable from any API
 * route, and BYOK custom endpoints always use the strict policy.
 */
export interface EndpointPolicy {
  allowHttp: boolean;
  allowPrivateNetwork: boolean;
  /** Empty = any port except the blocked list below. */
  allowedPorts?: readonly number[];
}

export const strictEndpointPolicy: EndpointPolicy = {
  allowHttp: false,
  allowPrivateNetwork: false
};

// Ports of common internal services that a model API has no reason to live on.
const blockedPorts = new Set([
  0, 21, 22, 23, 25, 53, 110, 111, 135, 139, 143, 445, 465, 587, 993, 995, 2375, 2376, 2379, 2380,
  3306, 5432, 5984, 6379, 6443, 9200, 9300, 10250, 10255, 11211, 27017
]);

const blockedHostnames = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
  "kubernetes",
  "kubernetes.default",
  "kubernetes.default.svc"
]);

const blockedHostnameSuffixes = [
  ".localhost",
  ".internal",
  ".local",
  ".localdomain",
  ".home.arpa",
  ".cluster.local",
  ".svc"
];

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["100::", 64]
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

/** True when an IP literal is loopback, private, link-local, metadata, CGNAT, reserved, etc. */
export function isBlockedAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/gu, "").toLowerCase();
  const family = isIP(normalized);
  if (family === 4) return blockedAddresses.check(normalized, "ipv4");
  if (family !== 6) return true;
  const embeddedV4 = embeddedIpv4(normalized);
  if (embeddedV4 !== null) return blockedAddresses.check(embeddedV4, "ipv4");
  return blockedAddresses.check(normalized, "ipv6");
}

/**
 * IPv4-mapped (::ffff:a.b.c.d / ::ffff:7f00:1), IPv4-compatible (::a.b.c.d) and NAT64
 * (64:ff9b::a.b.c.d) addresses all reach the embedded IPv4 host, so they are judged by it.
 */
function embeddedIpv4(address: string): string | null {
  const dotted = /^(?:::ffff:|::|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(address);
  if (dotted?.[1] !== undefined) return dotted[1];
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(address);
  if (hex?.[1] !== undefined && hex[2] !== undefined) {
    const high = Number.parseInt(hex[1], 16);
    const low = Number.parseInt(hex[2], 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return null;
}

export function assertPublicAddress(address: string, policy: EndpointPolicy): void {
  if (policy.allowPrivateNetwork) return;
  if (isBlockedAddress(address)) {
    throw new InferenceError("ENDPOINT_FORBIDDEN", {
      diagnostic: "Provider endpoint resolved to a private, loopback, or reserved address."
    });
  }
}

/**
 * Static URL validation. Returns the parsed URL with a normalized trailing slash so relative paths
 * (`chat/completions`) resolve under the configured base path.
 */
export function validateProviderEndpoint(rawUrl: string, policy: EndpointPolicy): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw forbidden("Provider endpoint is not a valid URL.");
  }
  if (url.protocol !== "https:" && !(policy.allowHttp && url.protocol === "http:")) {
    throw forbidden("Provider endpoint must use https.");
  }
  if (url.username !== "" || url.password !== "") {
    throw forbidden("Provider endpoint must not embed credentials.");
  }
  if (url.search !== "" || url.hash !== "") {
    throw forbidden("Provider endpoint must not include a query string or fragment.");
  }
  const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  if (policy.allowedPorts !== undefined && policy.allowedPorts.length > 0) {
    if (!policy.allowedPorts.includes(port))
      throw forbidden("Provider endpoint port is not allowed.");
  } else if (blockedPorts.has(port)) {
    throw forbidden("Provider endpoint port is not allowed.");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (!policy.allowPrivateNetwork) {
    if (
      blockedHostnames.has(hostname) ||
      blockedHostnameSuffixes.some((suffix) => hostname.endsWith(suffix))
    ) {
      throw forbidden("Provider endpoint host is internal.");
    }
    const literal = hostname.replace(/^\[|\]$/gu, "");
    if (isIP(literal) !== 0 && isBlockedAddress(literal)) {
      throw forbidden("Provider endpoint address is private or reserved.");
    }
    // Decimal/octal/hex integer hosts (http://2130706433/) are normalized by WHATWG URL into
    // dotted form already, so the isIP branch above covers them.
    if (!hostname.includes(".") && isIP(literal) === 0) {
      throw forbidden("Provider endpoint host must be a fully qualified domain name.");
    }
  }
  if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
  return url;
}

function forbidden(diagnostic: string): InferenceError {
  return new InferenceError("ENDPOINT_FORBIDDEN", { diagnostic }, diagnostic);
}
