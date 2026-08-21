import type { RuntimeToolDefinition, RuntimeToolName } from "../contracts/runtime.js";

export const messagingRuntimeTools = {
  "messaging.send": {
    name: "messaging.send",
    description: "Send a message to a customer over a connected channel.",
    risk: "high",
    requiresConfirmation: true,
    readOnly: false,
    requiredPermission: "customer:write",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", required: true, description: "Message body." },
        customerId: { type: "string", description: "Recipient customer id." },
        customerName: { type: "string", description: "Recipient customer name." },
        conversationId: { type: "string", description: "Existing conversation to reply in." },
        provider: { type: "string", description: "Channel provider (e.g. sms, email)." },
        mailboxId: { type: "string", description: "Connected mailbox to send from." },
        subject: { type: "string", description: "Message subject, for email-like channels." },
        replyToMessageId: { type: "string", description: "Message being replied to." },
        attachments: { type: "array", description: "Attachments to include, e.g. an invoice." }
      }
    },
    mcpExposable: false
  }
} satisfies Partial<Record<RuntimeToolName, RuntimeToolDefinition>>;
