import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { Readable } from "node:stream";

import {
  assertPublicAddress,
  validateProviderEndpoint,
  type EndpointPolicy
} from "./endpoint-policy.js";
import { InferenceError } from "./errors.js";

/**
 * The only way provider adapters reach the network. A fetch-shaped function so adapters stay
 * testable with a fake, but the production implementation is node:http(s) with:
 *
 * - the endpoint policy re-validated on every request (not only when the provider was configured);
 * - a pinned DNS lookup that rejects private/loopback/metadata addresses at connect time, which is
 *   what defeats DNS rebinding (the address that is checked is the address that is dialed);
 * - redirects never followed - any 3xx is an ENDPOINT_FORBIDDEN failure, so a public endpoint
 *   cannot bounce the request (and its Authorization header) somewhere internal.
 */
export type ProviderTransport = (url: URL, init: ProviderTransportInit) => Promise<Response>;

export interface ProviderTransportInit {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export type AddressResolver = (
  hostname: string,
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void
) => void;

const defaultResolver: AddressResolver = (hostname, callback) =>
  dnsLookup(hostname, { all: true, verbatim: true }, callback);

/**
 * A net.LookupFunction that resolves every address for the host and fails the connection if any
 * of them is blocked by the policy. Exported for direct unit testing with a fake resolver.
 */
export function createPinnedLookup(
  policy: EndpointPolicy,
  resolver: AddressResolver = defaultResolver
): LookupFunction {
  return (hostname, options, callback) => {
    resolver(hostname, (error, addresses) => {
      if (error !== null) {
        callback(error, "", 4);
        return;
      }
      try {
        if (addresses.length === 0) {
          throw new InferenceError("PROVIDER_UNAVAILABLE", {
            diagnostic: "DNS returned no addresses."
          });
        }
        for (const entry of addresses) assertPublicAddress(entry.address, policy);
      } catch (policyError) {
        callback(policyError as NodeJS.ErrnoException, "", 4);
        return;
      }
      if (options.all === true) {
        callback(null, addresses);
        return;
      }
      const first = addresses[0] as LookupAddress;
      callback(null, first.address, first.family);
    });
  };
}

export function createGuardedTransport(
  policy: EndpointPolicy,
  options: { resolver?: AddressResolver } = {}
): ProviderTransport {
  const lookup = createPinnedLookup(policy, options.resolver);
  return (url, init) =>
    new Promise<Response>((resolve, reject) => {
      const target = validateProviderEndpoint(url.toString(), policy);
      // validateProviderEndpoint appends a trailing slash for base URLs; request URLs keep theirs.
      target.pathname = url.pathname;
      const client = target.protocol === "https:" ? https : http;
      const request = client.request(
        target,
        {
          method: init.method,
          headers: {
            ...init.headers,
            ...(init.body === undefined ? {} : { "content-length": Buffer.byteLength(init.body) })
          },
          lookup,
          ...(init.signal === undefined ? {} : { signal: init.signal })
        },
        (incoming) => {
          const status = incoming.statusCode ?? 502;
          if (status >= 300 && status < 400) {
            incoming.resume();
            reject(
              new InferenceError("ENDPOINT_FORBIDDEN", {
                status,
                diagnostic: "Provider endpoint attempted a redirect; redirects are never followed."
              })
            );
            return;
          }
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (value === undefined) continue;
            for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
          }
          const body =
            status === 204 || status === 304
              ? null
              : (Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>);
          resolve(new Response(body, { status, headers }));
        }
      );
      request.on("error", reject);
      if (init.body !== undefined) request.write(init.body);
      request.end();
    });
}

/**
 * Adapts a plain fetch implementation (tests, or an environment that supplies its own egress
 * proxy) to ProviderTransport while still enforcing the static endpoint policy and the no-redirect
 * rule. DNS pinning is only available through createGuardedTransport.
 */
export function transportFromFetch(
  fetchImpl: typeof fetch,
  policy: EndpointPolicy
): ProviderTransport {
  return async (url, init) => {
    const target = validateProviderEndpoint(url.toString(), policy);
    target.pathname = url.pathname;
    const response = await fetchImpl(target, {
      method: init.method,
      headers: init.headers,
      ...(init.body === undefined ? {} : { body: init.body }),
      ...(init.signal === undefined ? {} : { signal: init.signal }),
      redirect: "manual",
      credentials: "omit"
    });
    if (response.status >= 300 && response.status < 400) {
      throw new InferenceError("ENDPOINT_FORBIDDEN", {
        status: response.status,
        diagnostic: "Provider endpoint attempted a redirect; redirects are never followed."
      });
    }
    return response;
  };
}
