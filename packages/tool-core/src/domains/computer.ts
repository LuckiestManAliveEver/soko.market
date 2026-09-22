import type { RuntimeToolDefinition, RuntimeToolName } from "../contracts/runtime.js";

/**
 * ComputerRuntime capabilities (docs/architecture/computer-runtime.md). Every entry here is
 * deliberately `requiresConfirmation: false` at the static registry level: whether one specific
 * click/type/upload call is consequential is contextual (target + semantic intent), decided per
 * call by the computer-runtime domain's ComputerActionPolicy, not by the generic tool name - see
 * computer-runtime-audit.md §3 ("architectural conflict #2"). A CONSEQUENTIAL call still never
 * executes without explicit user approval; it just gets there through a domain-owned approval
 * record (services/api/src/cp2/domains/computer-runtime) rather than this registry's static
 * confirmationToken gate, because the same generic tool name can be innocuous or consequential
 * depending on what it targets.
 */
export const computerRuntimeTools = {
  "computer.session.create": {
    name: "computer.session.create",
    description:
      "Open a new isolated browser session, optionally against a saved authenticated profile.",
    risk: "medium",
    requiresConfirmation: false,
    readOnly: false,
    requiredPermission: "computer:use",
    inputSchema: {
      type: "object",
      properties: {
        profileId: { type: "string", description: "Optional saved ComputerProfile id to resume." },
        startUrl: {
          type: "string",
          description: "Optional URL to navigate to once the session opens."
        }
      }
    },
    mcpExposable: false
  },
  "computer.session.resume": {
    name: "computer.session.resume",
    description: "Resume a suspended computer session.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: false,
    requiredPermission: "computer:use",
    inputSchema: {
      type: "object",
      properties: {
        computerSessionId: { type: "string", required: true, description: "Session to resume." }
      }
    },
    mcpExposable: false
  },
  "computer.navigate": {
    name: "computer.navigate",
    description: "Navigate the active computer session to a URL.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: true,
    requiredPermission: "computer:use",
    inputSchema: {
      type: "object",
      properties: {
        computerSessionId: { type: "string", required: true, description: "Target session." },
        url: { type: "string", required: true, description: "Absolute URL to navigate to." }
      }
    },
    mcpExposable: false
  },
  "computer.observe": {
    name: "computer.observe",
    description:
      "Read the current page state of the computer session (URL, title, visible content).",
    risk: "low",
    requiresConfirmation: false,
    readOnly: true,
    requiredPermission: "computer:use",
    inputSchema: {
      type: "object",
      properties: {
        computerSessionId: { type: "string", required: true, description: "Target session." }
      }
    },
    mcpExposable: false
  },
  "computer.click": {
    name: "computer.click",
    description:
      "Click an element on the current page, described in words (e.g. 'Send button'). Submitting, " +
      "purchasing, publishing, deleting or otherwise consequential targets pause for explicit user " +
      "approval before executing.",
    risk: "medium",
    requiresConfirmation: false,
    readOnly: false,
    requiredPermission: "computer:use",
    inputSchema: {
      type: "object",
      properties: {
        computerSessionId: { type: "string", required: true, description: "Target session." },
        targetDescription: {
          type: "string",
          required: true,
          description: "Plain-language description of the element to click."
        },
        targetRef: {
          type: "string",
          description: "Optional stable ref from a prior observe() call."
        }
      }
    },
    mcpExposable: false
  },
  "computer.type": {
    name: "computer.type",
    description:
      "Type text into a field on the current page. Never used for passwords, OTPs, card numbers " +
      "or other credentials - those fields are refused.",
    risk: "medium",
    requiresConfirmation: false,
    readOnly: false,
    requiredPermission: "computer:use",
    inputSchema: {
      type: "object",
      properties: {
        computerSessionId: { type: "string", required: true, description: "Target session." },
        targetDescription: {
          type: "string",
          required: true,
          description: "Plain-language description of the field to type into."
        },
        targetRef: {
          type: "string",
          description: "Optional stable ref from a prior observe() call."
        },
        text: { type: "string", required: true, description: "Text to type." },
        submit: { type: "boolean", description: "Press Enter after typing." }
      }
    },
    mcpExposable: false
  },
  "computer.scroll": {
    name: "computer.scroll",
    description: "Scroll the current page up or down.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: true,
    requiredPermission: "computer:use",
    inputSchema: {
      type: "object",
      properties: {
        computerSessionId: { type: "string", required: true, description: "Target session." },
        direction: { type: "string", required: true, description: "'up' or 'down'." }
      }
    },
    mcpExposable: false
  },
  "computer.upload": {
    name: "computer.upload",
    description:
      "Upload an already-authorized attachment through a file input on the current page.",
    risk: "medium",
    requiresConfirmation: false,
    readOnly: false,
    requiredPermission: "computer:use",
    inputSchema: {
      type: "object",
      properties: {
        computerSessionId: { type: "string", required: true, description: "Target session." },
        targetDescription: {
          type: "string",
          required: true,
          description: "Plain-language description of the file input."
        },
        attachmentId: {
          type: "string",
          required: true,
          description: "Id of an attachment already authorized for this conversation."
        }
      }
    },
    mcpExposable: false
  },
  "computer.control.take": {
    name: "computer.control.take",
    description: "Hand control of the live browser session to the human user; agent actions pause.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: false,
    requiredPermission: "computer:control",
    inputSchema: {
      type: "object",
      properties: {
        computerSessionId: { type: "string", required: true, description: "Target session." }
      }
    },
    mcpExposable: false
  },
  "computer.control.release": {
    name: "computer.control.release",
    description:
      "Return control of the live browser session to the agent after the human finishes (e.g. " +
      "completing a login, MFA, or CAPTCHA challenge). Refreshes the observation before the agent resumes.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: false,
    requiredPermission: "computer:control",
    inputSchema: {
      type: "object",
      properties: {
        computerSessionId: { type: "string", required: true, description: "Target session." }
      }
    },
    mcpExposable: false
  },
  "computer.checkpoint": {
    name: "computer.checkpoint",
    description:
      "Capture an immutable RuntimeHandoff checkpoint of the computer session's progress.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: true,
    requiredPermission: "computer:use",
    inputSchema: {
      type: "object",
      properties: {
        computerSessionId: { type: "string", required: true, description: "Target session." }
      }
    },
    mcpExposable: false
  },
  "computer.suspend": {
    name: "computer.suspend",
    description: "Suspend a computer session without closing it, freeing its worker resources.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: false,
    requiredPermission: "computer:use",
    inputSchema: {
      type: "object",
      properties: {
        computerSessionId: { type: "string", required: true, description: "Target session." }
      }
    },
    mcpExposable: false
  },
  "computer.close": {
    name: "computer.close",
    description: "Permanently close a computer session.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: false,
    requiredPermission: "computer:use",
    inputSchema: {
      type: "object",
      properties: {
        computerSessionId: { type: "string", required: true, description: "Target session." }
      }
    },
    mcpExposable: false
  }
} satisfies Partial<Record<RuntimeToolName, RuntimeToolDefinition>>;
