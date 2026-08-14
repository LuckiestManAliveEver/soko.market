import { timingSafeEqual } from "node:crypto";
import type {
  ChannelCapability,
  ChannelEndpointSummary,
  ChannelProvider,
  ChannelProviderReadiness,
  ChannelSelectionResult,
  ConversationChannelSummary,
  MessageChannel,
  PlatformIdentitySummary
} from "@soko/shared-types";

export type ChannelErrorCode =
  | "CHANNEL_NOT_CONNECTED"
  | "CHANNEL_UNAVAILABLE"
  | "CHANNEL_IDENTITY_NOT_FOUND"
  | "CHANNEL_INITIATION_NOT_ALLOWED"
  | "CHANNEL_REPLY_WINDOW_EXPIRED"
  | "CHANNEL_OPT_IN_REQUIRED"
  | "CHANNEL_TEMPLATE_REQUIRED"
  | "CHANNEL_IDENTITY_ALREADY_LINKED"
  | "CHANNEL_RATE_LIMITED"
  | "CHANNEL_SEND_FAILED"
  | "PROVIDER_AUTH_EXPIRED"
  | "CHANNEL_WEBHOOK_INVALID"
  | "CHANNEL_INBOUND_UNSUPPORTED"
  | "SMS_DEVICE_UNAVAILABLE"
  | "SMS_SETUP_REQUIRED"
  | "SMS_PERMISSION_REQUIRED"
  | "SMS_ROLE_REQUIRED"
  | "SMS_SIM_UNAVAILABLE"
  | "SMS_SIM_SELECTION_REQUIRED"
  | "SMS_NO_SERVICE"
  | "SMS_SEND_FAILED"
  | "SMS_DELIVERY_UNKNOWN";

export class ChannelGatewayError extends Error {
  constructor(
    readonly code: ChannelErrorCode,
    message: string,
    readonly retryable = false
  ) {
    super(message);
    this.name = "ChannelGatewayError";
  }
}

export interface OutboundChannelMessage {
  businessId: string;
  conversationId: string;
  customerId: string | null;
  idempotencyKey: string;
  text: string;
  endpoint: ChannelEndpointSummary;
}

export interface ChannelSendResult {
  accepted: boolean;
  providerMessageId: string | null;
  status: "queued" | "sent" | "delivered";
}

export interface CanonicalInboundChannelMessage {
  provider: ChannelProvider;
  externalUpdateId: string;
  externalMessageId: string;
  externalUserId: string;
  externalConversationId: string;
  displayName: string | null;
  text: string;
  linkToken: string | null;
  receivedAt: string;
}

export interface MessagingChannelAdapter {
  readonly provider: ChannelProvider;
  readiness(context?: { businessId?: string }): ChannelProviderReadiness;
  getCapabilities(input: {
    channel: ConversationChannelSummary;
    identity: PlatformIdentitySummary;
  }): ChannelCapability[];
  sendMessage(request: OutboundChannelMessage): Promise<ChannelSendResult>;
  validateWebhook?(headers: Record<string, string | string[] | undefined>): boolean;
  normalizeInbound?(payload: unknown): CanonicalInboundChannelMessage;
  createLinkUrl?(token: string): string | null;
  executionContext?(businessId: string): {
    environment: "server" | "android-device";
    deviceId: string | null;
  };
}

export interface NativeSmsDeviceTransport {
  readiness(businessId?: string): {
    configured: boolean;
    authorized: boolean;
    status: "available" | "unavailable" | "setup_required" | "offline" | "error";
    deviceId: string | null;
    configurationRequirement: string | null;
    errorCode: ChannelErrorCode | null;
  };
  queue(request: OutboundChannelMessage): {
    commandId: string;
    waitingForDevice: boolean;
  };
}

export class ChannelGateway {
  private readonly adapters: Map<ChannelProvider, MessagingChannelAdapter>;

  constructor(adapters: MessagingChannelAdapter[]) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.provider, adapter]));
  }

  registerAdapter(adapter: MessagingChannelAdapter): void {
    this.adapters.set(adapter.provider, adapter);
  }

  providerReadiness(context?: { businessId?: string }): ChannelProviderReadiness[] {
    return [...this.adapters.values()].map((adapter) => adapter.readiness(context));
  }

  endpoint(
    channel: ConversationChannelSummary,
    identity: PlatformIdentitySummary
  ): ChannelEndpointSummary {
    const adapter = this.adapters.get(channel.provider);
    const readiness =
      adapter?.readiness({ businessId: channel.businessId }) ??
      unavailableReadiness(channel.provider);
    const execution = adapter?.executionContext?.(channel.businessId) ?? {
      environment: "server" as const,
      deviceId: null
    };
    const capabilities = (adapter?.getCapabilities({ channel, identity }) ?? []).filter(
      (capability) => capability !== "REQUIRES_OPT_IN" || identity.optInStatus !== "granted"
    );
    const optedOut = identity.optInStatus === "revoked" || identity.optOutAt !== null;
    return {
      channelId: channel.id,
      conversationId: channel.conversationId,
      businessId: channel.businessId,
      customerId: identity.customerId,
      channelIdentityId: identity.id,
      provider: channel.provider,
      externalUserId: identity.externalUserId,
      externalConversationId: channel.externalConversationId,
      capabilities,
      status:
        optedOut || channel.status === "blocked"
          ? "blocked"
          : readiness.status === "available"
            ? channel.status
            : readiness.status,
      configured: readiness.configured,
      authorized: readiness.authorized,
      readinessErrorCode: readiness.readinessErrorCode ?? null,
      executionEnvironment: execution.environment,
      executionDeviceId: execution.deviceId,
      lastInboundAt: channel.lastInboundAt,
      lastOutboundAt: channel.lastOutboundAt
    };
  }

  select(input: {
    endpoints: ChannelEndpointSummary[];
    preferredProvider?: ChannelProvider;
    currentProvider?: ChannelProvider;
  }): ChannelSelectionResult {
    if (input.preferredProvider !== undefined) {
      const preferred = input.endpoints.find(
        (endpoint) => endpoint.provider === input.preferredProvider
      );
      if (preferred === undefined) {
        throw new ChannelGatewayError(
          "CHANNEL_IDENTITY_NOT_FOUND",
          `No ${input.preferredProvider} identity is linked to this customer.`
        );
      }
      this.assertCanSend(preferred);
      return { endpoint: preferred, reason: "preferred_channel" };
    }

    const current = input.endpoints.find(
      (endpoint) => endpoint.provider === input.currentProvider && canSend(endpoint)
    );
    if (current !== undefined) {
      return { endpoint: current, reason: "current_conversation_channel" };
    }

    const recent = input.endpoints
      .filter(canSend)
      .filter((endpoint) => endpoint.lastInboundAt !== null || endpoint.lastOutboundAt !== null)
      .sort((left, right) => activityTime(right) - activityTime(left))[0];
    if (recent !== undefined) {
      return { endpoint: recent, reason: "most_recent_reachable_channel" };
    }

    const soko = input.endpoints.find(
      (endpoint) => endpoint.provider === "soko" && canSend(endpoint)
    );
    if (soko !== undefined) return { endpoint: soko, reason: "soko_identity" };

    const eligible = input.endpoints.find(canSend);
    if (eligible !== undefined) {
      return { endpoint: eligible, reason: "eligible_linked_channel" };
    }
    throw new ChannelGatewayError(
      "CHANNEL_UNAVAILABLE",
      "This customer has no channel that currently permits this message."
    );
  }

  async send(
    request: Omit<OutboundChannelMessage, "endpoint"> & {
      endpoints: ChannelEndpointSummary[];
      preferredProvider?: ChannelProvider;
      currentProvider?: ChannelProvider;
    }
  ): Promise<{ selection: ChannelSelectionResult; result: ChannelSendResult }> {
    const selection = this.select(request);
    const adapter = this.adapters.get(selection.endpoint.provider);
    if (adapter === undefined) {
      throw new ChannelGatewayError("CHANNEL_UNAVAILABLE", "The selected channel is unavailable.");
    }
    const result = await adapter.sendMessage({ ...request, endpoint: selection.endpoint });
    return { selection, result };
  }

  normalizeInbound(input: {
    provider: ChannelProvider;
    headers: Record<string, string | string[] | undefined>;
    payload: unknown;
  }): CanonicalInboundChannelMessage {
    const adapter = this.adapters.get(input.provider);
    if (adapter?.normalizeInbound === undefined) {
      throw new ChannelGatewayError(
        "CHANNEL_INBOUND_UNSUPPORTED",
        "Inbound messaging is unavailable for this provider."
      );
    }
    if (adapter.validateWebhook?.(input.headers) !== true) {
      throw new ChannelGatewayError("CHANNEL_WEBHOOK_INVALID", "Webhook authentication failed.");
    }
    return adapter.normalizeInbound(input.payload);
  }

  createLinkUrl(provider: ChannelProvider, token: string): string | null {
    return this.adapters.get(provider)?.createLinkUrl?.(token) ?? null;
  }

  private assertCanSend(endpoint: ChannelEndpointSummary): void {
    if (endpoint.status === "blocked") {
      throw new ChannelGatewayError("CHANNEL_UNAVAILABLE", "The recipient blocked this channel.");
    }
    if (endpoint.status === "setup_required") {
      throw new ChannelGatewayError(
        isChannelErrorCode(endpoint.readinessErrorCode)
          ? endpoint.readinessErrorCode
          : "SMS_SETUP_REQUIRED",
        "Native SMS setup must be completed on the linked Android device."
      );
    }
    if (endpoint.status === "error") {
      throw new ChannelGatewayError(
        "SMS_DEVICE_UNAVAILABLE",
        "The linked Android SMS device reported an error."
      );
    }
    if (endpoint.status === "offline" && !endpoint.capabilities.includes("SUPPORTS_OFFLINE")) {
      throw new ChannelGatewayError("SMS_DEVICE_UNAVAILABLE", "The delivery device is offline.");
    }
    if (!endpoint.configured || endpoint.status === "unavailable") {
      throw new ChannelGatewayError(
        endpoint.provider === "native_sms" ? "SMS_DEVICE_UNAVAILABLE" : "CHANNEL_NOT_CONNECTED",
        endpoint.provider === "native_sms"
          ? "No authenticated SMS-capable Android device is available."
          : "The selected channel is not connected."
      );
    }
    if (!endpoint.authorized || endpoint.status === "authorization_required") {
      throw new ChannelGatewayError(
        "PROVIDER_AUTH_EXPIRED",
        "The selected provider needs authorization."
      );
    }
    if (endpoint.status === "expired") {
      throw new ChannelGatewayError(
        "CHANNEL_REPLY_WINDOW_EXPIRED",
        "The provider reply window has expired."
      );
    }
    if (endpoint.capabilities.includes("REQUIRES_OPT_IN")) {
      throw new ChannelGatewayError(
        "CHANNEL_OPT_IN_REQUIRED",
        "Recipient opt-in is required for this channel."
      );
    }
    if (
      endpoint.capabilities.includes("REQUIRES_EXISTING_THREAD") &&
      endpoint.lastInboundAt === null
    ) {
      throw new ChannelGatewayError(
        "CHANNEL_INITIATION_NOT_ALLOWED",
        "This provider requires the recipient to start the conversation."
      );
    }
    if (
      !endpoint.capabilities.includes("CAN_REPLY") &&
      !endpoint.capabilities.includes("CAN_INITIATE")
    ) {
      throw new ChannelGatewayError(
        endpoint.capabilities.includes("REQUIRES_TEMPLATE")
          ? "CHANNEL_TEMPLATE_REQUIRED"
          : "CHANNEL_INITIATION_NOT_ALLOWED",
        "The selected channel does not permit this message."
      );
    }
  }
}

export function createChannelGatewayFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch
): ChannelGateway {
  const telegramToken = environment.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const telegramSecret = environment.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "";
  const telegramUsername = environment.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/u, "") ?? "";
  if ((telegramToken === "") !== (telegramSecret === "")) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must both be configured for Telegram messaging."
    );
  }
  return new ChannelGateway([
    new SokoChannelAdapter(),
    new TelegramChannelAdapter({
      token: telegramToken,
      webhookSecret: telegramSecret,
      botUsername: telegramUsername,
      fetcher
    }),
    disabledAdapter(
      "whatsapp",
      ["REQUIRES_OPT_IN", "REQUIRES_TEMPLATE"],
      "WhatsApp Business Cloud API credentials and approved templates are required."
    ),
    disabledAdapter(
      "messenger",
      ["REQUIRES_EXISTING_THREAD"],
      "A Meta Page messaging authorization is required."
    ),
    disabledAdapter(
      "instagram",
      ["REQUIRES_EXISTING_THREAD"],
      "An Instagram professional messaging authorization is required."
    ),
    disabledAdapter("tiktok", [], "TikTok Business Messaging API access is not configured."),
    disabledAdapter("x", [], "An X API tier with Direct Message access is not configured."),
    disabledAdapter(
      "sms",
      [],
      "No server-side SMS provider or trusted native bridge is configured."
    ),
    disabledAdapter(
      "native_sms",
      [
        "CAN_SEND",
        "CAN_RECEIVE",
        "CAN_REPLY",
        "CAN_INITIATE",
        "SUPPORTS_OFFLINE",
        "REQUIRES_ANDROID_DEVICE",
        "REQUIRES_SIM",
        "REQUIRES_SMS_PERMISSION",
        "REQUIRES_DEFAULT_SMS_ROLE"
      ],
      "No authenticated SMS-capable Android device is registered."
    )
  ]);
}

export function providerToMessageChannel(provider: ChannelProvider): MessageChannel {
  const channels: Record<ChannelProvider, MessageChannel> = {
    soko: "soko",
    telegram: "telegram",
    whatsapp: "whatsapp_business",
    messenger: "facebook_messenger",
    instagram: "instagram_messaging",
    tiktok: "tiktok_business",
    x: "x_dm",
    sms: "sms",
    native_sms: "native_sms"
  };
  return channels[provider];
}

class SokoChannelAdapter implements MessagingChannelAdapter {
  readonly provider = "soko" as const;

  readiness(): ChannelProviderReadiness {
    return {
      provider: this.provider,
      configured: true,
      authorized: true,
      capabilities: ["CAN_RECEIVE", "CAN_REPLY", "CAN_INITIATE", "SUPPORTS_PRODUCT_CARD"],
      status: "available",
      configurationRequirement: null
    };
  }

  getCapabilities(): ChannelCapability[] {
    return [...this.readiness().capabilities];
  }

  async sendMessage(): Promise<ChannelSendResult> {
    return { accepted: true, providerMessageId: null, status: "delivered" };
  }
}

class TelegramChannelAdapter implements MessagingChannelAdapter {
  readonly provider = "telegram" as const;

  constructor(
    private readonly config: {
      token: string;
      webhookSecret: string;
      botUsername: string;
      fetcher: typeof fetch;
    }
  ) {}

  readiness(): ChannelProviderReadiness {
    const configured = this.config.token !== "" && this.config.webhookSecret !== "";
    return {
      provider: this.provider,
      configured,
      authorized: configured,
      capabilities: [
        "CAN_RECEIVE",
        "CAN_REPLY",
        "REQUIRES_EXISTING_THREAD",
        "SUPPORTS_MEDIA",
        "SUPPORTS_PRODUCT_CARD"
      ],
      status: configured ? "available" : "unavailable",
      configurationRequirement: configured
        ? null
        : "TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET are required."
    };
  }

  getCapabilities(): ChannelCapability[] {
    return [...this.readiness().capabilities];
  }

  validateWebhook(headers: Record<string, string | string[] | undefined>): boolean {
    if (!this.readiness().configured) return false;
    const supplied = headers["x-telegram-bot-api-secret-token"];
    const value = Array.isArray(supplied) ? supplied[0] : supplied;
    return value !== undefined && safeEqual(value, this.config.webhookSecret);
  }

  normalizeInbound(payload: unknown): CanonicalInboundChannelMessage {
    const update = record(payload, "Telegram update");
    const message = record(update.message, "Telegram message");
    const from = record(message.from, "Telegram sender");
    const chat = record(message.chat, "Telegram chat");
    const text = string(message.text, "Telegram message text", 4096);
    const command = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([A-Za-z0-9_-]{16,200}))?$/u.exec(text);
    return {
      provider: this.provider,
      externalUpdateId: identifier(update.update_id, "Telegram update id"),
      externalMessageId: identifier(message.message_id, "Telegram message id"),
      externalUserId: identifier(from.id, "Telegram user id"),
      externalConversationId: identifier(chat.id, "Telegram chat id"),
      displayName: telegramDisplayName(from),
      text,
      linkToken: command?.[1] ?? null,
      receivedAt: new Date().toISOString()
    };
  }

  createLinkUrl(token: string): string | null {
    return this.config.botUsername === ""
      ? null
      : `https://t.me/${encodeURIComponent(this.config.botUsername)}?start=${encodeURIComponent(token)}`;
  }

  async sendMessage(request: OutboundChannelMessage): Promise<ChannelSendResult> {
    if (!this.readiness().configured) {
      throw new ChannelGatewayError("CHANNEL_NOT_CONNECTED", "Telegram is not configured.");
    }
    let response: Response;
    try {
      response = await this.config.fetcher(
        `https://api.telegram.org/bot${this.config.token}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: request.endpoint.externalConversationId,
            text: request.text
          }),
          signal: AbortSignal.timeout(10_000)
        }
      );
    } catch {
      throw new ChannelGatewayError(
        "CHANNEL_SEND_FAILED",
        "Telegram delivery was temporarily unavailable.",
        true
      );
    }
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      result?: { message_id?: string | number };
      error_code?: number;
    } | null;
    if (!response.ok || payload?.ok !== true) {
      const rateLimited = response.status === 429 || payload?.error_code === 429;
      throw new ChannelGatewayError(
        rateLimited ? "CHANNEL_RATE_LIMITED" : "CHANNEL_SEND_FAILED",
        rateLimited ? "Telegram rate limited this message." : "Telegram rejected this message.",
        rateLimited || response.status >= 500
      );
    }
    return {
      accepted: true,
      providerMessageId:
        payload.result?.message_id === undefined ? null : String(payload.result.message_id),
      status: "sent"
    };
  }
}

function disabledAdapter(
  provider: Exclude<ChannelProvider, "soko" | "telegram">,
  capabilities: ChannelCapability[],
  requirement: string
): MessagingChannelAdapter {
  return {
    provider,
    readiness: () => ({
      provider,
      configured: false,
      authorized: false,
      capabilities,
      status: "unavailable",
      configurationRequirement: requirement
    }),
    getCapabilities: () => [...capabilities],
    sendMessage: async () => {
      throw new ChannelGatewayError("CHANNEL_NOT_CONNECTED", requirement);
    }
  };
}

function canSend(endpoint: ChannelEndpointSummary): boolean {
  if (!endpoint.configured || !endpoint.authorized) return false;
  if (
    endpoint.status !== "available" &&
    !(endpoint.status === "offline" && endpoint.capabilities.includes("SUPPORTS_OFFLINE"))
  ) {
    return false;
  }
  if (endpoint.capabilities.includes("REQUIRES_OPT_IN")) return false;
  if (
    endpoint.capabilities.includes("REQUIRES_EXISTING_THREAD") &&
    endpoint.lastInboundAt === null
  ) {
    return false;
  }
  return (
    endpoint.capabilities.includes("CAN_REPLY") || endpoint.capabilities.includes("CAN_INITIATE")
  );
}

export function createNativeSmsChannelAdapter(
  transport: NativeSmsDeviceTransport
): MessagingChannelAdapter {
  const capabilities: ChannelCapability[] = [
    "CAN_SEND",
    "CAN_RECEIVE",
    "CAN_REPLY",
    "CAN_INITIATE",
    "SUPPORTS_OFFLINE",
    "REQUIRES_ANDROID_DEVICE",
    "REQUIRES_SIM",
    "REQUIRES_SMS_PERMISSION",
    "REQUIRES_DEFAULT_SMS_ROLE"
  ];
  return {
    provider: "native_sms",
    readiness: (context) => {
      const state = transport.readiness(context?.businessId);
      return {
        provider: "native_sms",
        configured: state.configured,
        authorized: state.authorized,
        capabilities,
        status: state.status,
        configurationRequirement: state.configurationRequirement,
        readinessErrorCode: state.errorCode
      };
    },
    getCapabilities: () => [...capabilities],
    executionContext: (businessId) => {
      const state = transport.readiness(businessId);
      return { environment: "android-device", deviceId: state.deviceId };
    },
    sendMessage: async (request) => {
      const queued = transport.queue(request);
      return {
        accepted: true,
        providerMessageId: queued.commandId,
        status: "queued"
      };
    }
  };
}

function activityTime(endpoint: ChannelEndpointSummary): number {
  return Math.max(
    endpoint.lastInboundAt === null ? 0 : Date.parse(endpoint.lastInboundAt),
    endpoint.lastOutboundAt === null ? 0 : Date.parse(endpoint.lastOutboundAt)
  );
}

function isChannelErrorCode(value: string | null | undefined): value is ChannelErrorCode {
  return typeof value === "string" && channelErrorCodes.has(value as ChannelErrorCode);
}

const channelErrorCodes = new Set<ChannelErrorCode>([
  "CHANNEL_NOT_CONNECTED",
  "CHANNEL_UNAVAILABLE",
  "CHANNEL_IDENTITY_NOT_FOUND",
  "CHANNEL_INITIATION_NOT_ALLOWED",
  "CHANNEL_REPLY_WINDOW_EXPIRED",
  "CHANNEL_OPT_IN_REQUIRED",
  "CHANNEL_TEMPLATE_REQUIRED",
  "CHANNEL_IDENTITY_ALREADY_LINKED",
  "CHANNEL_RATE_LIMITED",
  "CHANNEL_SEND_FAILED",
  "PROVIDER_AUTH_EXPIRED",
  "CHANNEL_WEBHOOK_INVALID",
  "CHANNEL_INBOUND_UNSUPPORTED",
  "SMS_DEVICE_UNAVAILABLE",
  "SMS_SETUP_REQUIRED",
  "SMS_PERMISSION_REQUIRED",
  "SMS_ROLE_REQUIRED",
  "SMS_SIM_UNAVAILABLE",
  "SMS_SIM_SELECTION_REQUIRED",
  "SMS_NO_SERVICE",
  "SMS_SEND_FAILED",
  "SMS_DELIVERY_UNKNOWN"
]);

function unavailableReadiness(provider: ChannelProvider): ChannelProviderReadiness {
  return {
    provider,
    configured: false,
    authorized: false,
    capabilities: [],
    status: "unavailable",
    configurationRequirement: "No provider adapter is registered."
  };
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ChannelGatewayError("CHANNEL_INBOUND_UNSUPPORTED", `${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > maximum) {
    throw new ChannelGatewayError("CHANNEL_INBOUND_UNSUPPORTED", `${label} is invalid.`);
  }
  return value.trim();
}

function identifier(value: unknown, label: string): string {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).length > 200) {
    throw new ChannelGatewayError("CHANNEL_INBOUND_UNSUPPORTED", `${label} is invalid.`);
  }
  return String(value);
}

function telegramDisplayName(from: Record<string, unknown>): string | null {
  const parts = [from.first_name, from.last_name].filter(
    (value): value is string => typeof value === "string" && value.trim() !== ""
  );
  const displayName = parts.join(" ").trim();
  return displayName === "" ? null : displayName.slice(0, 120);
}
