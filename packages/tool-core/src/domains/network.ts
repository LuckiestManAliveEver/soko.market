import type { RuntimeToolDefinition, RuntimeToolName } from "../contracts/runtime.js";

export const networkRuntimeTools = {
  "network.route": {
    name: "network.route",
    description: "Request an agent-mediated route to a matching second-degree network contact.",
    risk: "medium",
    requiresConfirmation: false,
    readOnly: false,
    requiredPermission: "business:read",
    inputSchema: {
      type: "object",
      properties: {
        requestText: {
          type: "string",
          required: true,
          description: "The owner's original network-discovery request."
        },
        targetNodeId: {
          type: "string",
          description: "Optional canonical network node identifier."
        }
      }
    },
    mcpExposable: false
  },
  "network.contacts.resolve": {
    name: "network.contacts.resolve",
    description: "Resolve a name, phone, email, or handle against the owner's own phonebook.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: true,
    requiredPermission: "business:read",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          required: true,
          description: "Name, phone, email, or handle fragment to resolve."
        }
      }
    },
    mcpExposable: false
  },
  "network.identity.list": {
    name: "network.identity.list",
    description: "List pending identity candidates awaiting the owner's confirmation.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: true,
    requiredPermission: "business:read",
    inputSchema: { type: "object", properties: {} },
    mcpExposable: false
  },
  "network.identity.propose": {
    name: "network.identity.propose",
    description:
      "Record a candidate identity seen while completing another task (e.g. a browsing " +
      "observation) as pending - never attaches it to the phonebook until the owner confirms it.",
    risk: "medium",
    requiresConfirmation: false,
    readOnly: false,
    requiredPermission: "business:write",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", required: true, description: "Where this identity was seen." },
        providerSubject: {
          type: "string",
          required: true,
          description: "The provider-specific identifier or handle observed."
        },
        displayName: {
          type: "string",
          required: true,
          description: "The name observed alongside this identity."
        },
        handle: { type: "string", description: "Optional public handle observed." },
        evidence: {
          type: "string",
          required: true,
          description: "Human-readable context for why this identity was proposed."
        }
      }
    },
    mcpExposable: false
  },
  "network.identity.confirm": {
    name: "network.identity.confirm",
    description:
      "Confirm a pending identity candidate, attaching it to an existing contact or a new one.",
    risk: "medium",
    requiresConfirmation: false,
    readOnly: false,
    requiredPermission: "business:write",
    inputSchema: {
      type: "object",
      properties: {
        candidateId: { type: "string", required: true, description: "Identity candidate ID." },
        targetNodeId: {
          type: "string",
          description: "Existing contact to attach this identity to, if not the guessed one."
        },
        createNewContact: {
          type: "boolean",
          description: "True to create a brand-new contact for this identity."
        }
      }
    },
    mcpExposable: false
  },
  "network.identity.reject": {
    name: "network.identity.reject",
    description: "Reject a pending identity candidate - it is discarded, never attached.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: false,
    requiredPermission: "business:write",
    inputSchema: {
      type: "object",
      properties: {
        candidateId: { type: "string", required: true, description: "Identity candidate ID." }
      }
    },
    mcpExposable: false
  },
  "network.identity.unlink": {
    name: "network.identity.unlink",
    description: "Remove a previously confirmed identity from a contact.",
    risk: "medium",
    requiresConfirmation: false,
    readOnly: false,
    requiredPermission: "business:write",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string", required: true, description: "Canonical network node ID." },
        externalIdentityId: {
          type: "string",
          required: true,
          description: "Identity to unlink from this contact."
        }
      }
    },
    mcpExposable: false
  },
  "network.identity.add": {
    name: "network.identity.add",
    description: "Directly add an owner-authored identity (e.g. a known handle) to a contact.",
    risk: "low",
    requiresConfirmation: false,
    readOnly: false,
    requiredPermission: "business:write",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string", required: true, description: "Canonical network node ID." },
        provider: { type: "string", required: true, description: "Identity provider or channel." },
        providerSubject: {
          type: "string",
          required: true,
          description: "Provider-specific identifier or handle."
        },
        displayName: { type: "string", description: "Optional display name override." },
        handle: { type: "string", description: "Optional public handle." }
      }
    },
    mcpExposable: false
  }
} satisfies Partial<Record<RuntimeToolName, RuntimeToolDefinition>>;
