import { inspect } from "node:util";

const redacted = "[REDACTED]";

/**
 * Holds a provider secret so it cannot leak by accident: String(), JSON.stringify(), template
 * literals, console.log/util.inspect and Fastify/pino serialization all print "[REDACTED]". The
 * only way to read the value is the deliberately named reveal(), which the provider adapters call
 * at the one place they build an Authorization/x-api-key header.
 */
export class SecretValue {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  /** Last four characters, for "••••x7K2"-style display. Null for keys too short to hint safely. */
  suffix(): string | null {
    return this.#value.length >= 16 ? this.#value.slice(-4) : null;
  }

  toString(): string {
    return redacted;
  }

  toJSON(): string {
    return redacted;
  }

  [inspect.custom](): string {
    return redacted;
  }
}
