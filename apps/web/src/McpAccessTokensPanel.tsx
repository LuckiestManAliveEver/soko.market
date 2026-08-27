import { useEffect, useState } from "react";

import type {
  McpAccessScope,
  McpAccessTokenCreated,
  McpAccessTokenSummary
} from "@soko/shared-types";

import { deleteJson, getJson, postJson } from "./api-helpers";
import { getErrorMessage } from "./chat-message-plumbing";
import { formatDate } from "./formatters";
import { readApiBaseUrl } from "./lib/api";

const modelLabOptions = [
  { id: "openai", label: "OpenAI API" },
  { id: "anthropic", label: "Anthropic API" },
  { id: "google", label: "Gemini API" },
  { id: "other", label: "Another MCP client" }
] as const;

type ModelLabId = (typeof modelLabOptions)[number]["id"];

function modelLabSetup(
  modelLabId: ModelLabId,
  shopConnectionUrl: string,
  accessToken: string
): { configuration: string; instructions: string } {
  if (modelLabId === "openai") {
    return {
      instructions:
        "Add this object as an MCP tool in an OpenAI Responses API request. The authorization value is the Soko connection secret, not your OpenAI API key.",
      configuration: JSON.stringify(
        {
          type: "mcp",
          server_label: "soko_shop",
          server_url: shopConnectionUrl,
          authorization: accessToken,
          require_approval: "always"
        },
        null,
        2
      )
    };
  }
  if (modelLabId === "anthropic") {
    return {
      instructions:
        "Merge these fields into an Anthropic Messages API request. The authorization_token is the Soko connection secret, not your Anthropic API key.",
      configuration: JSON.stringify(
        {
          mcp_servers: [
            {
              type: "url",
              name: "soko_shop",
              url: shopConnectionUrl,
              authorization_token: accessToken
            }
          ],
          tools: [{ type: "mcp_toolset", mcp_server_name: "soko_shop" }],
          betas: ["mcp-client-2025-11-20"]
        },
        null,
        2
      )
    };
  }
  if (modelLabId === "google") {
    return {
      instructions:
        "Add this object to tools in a Gemini Interactions API request. Keep your Gemini API key separate from the Soko Authorization header.",
      configuration: JSON.stringify(
        {
          type: "mcp_server",
          name: "soko_shop",
          url: shopConnectionUrl,
          headers: { Authorization: `Bearer ${accessToken}` }
        },
        null,
        2
      )
    };
  }
  return {
    instructions:
      "Add a remote Streamable HTTP MCP server with this URL and send the Soko secret in its Authorization header.",
    configuration: JSON.stringify(
      {
        url: shopConnectionUrl,
        headers: { Authorization: `Bearer ${accessToken}` }
      },
      null,
      2
    )
  };
}

export interface McpAccessTokensPanelProps {
  accountId: string;
  businessId: string;
  pendingProfileAction: string | null;
  runProfileAction: (key: string, action: () => Promise<void>) => Promise<void>;
  setProfileMessage: (message: string) => void;
  copyStorefrontValue: (value: string, label: string) => Promise<void>;
}

export function McpAccessTokensPanel({
  accountId,
  businessId,
  pendingProfileAction,
  runProfileAction,
  setProfileMessage,
  copyStorefrontValue
}: McpAccessTokensPanelProps) {
  const [mcpTokens, setMcpTokens] = useState<McpAccessTokenSummary[]>([]);
  const [modelLabId, setModelLabId] = useState<ModelLabId>("openai");
  const [mcpTokenName, setMcpTokenName] = useState("OpenAI API shop connection");
  const [mcpReadEnabled, setMcpReadEnabled] = useState(true);
  const [mcpActEnabled, setMcpActEnabled] = useState(false);
  const [mcpPin, setMcpPin] = useState("");
  const [newMcpAccessToken, setNewMcpAccessToken] = useState("");
  const [newMcpAccessScopes, setNewMcpAccessScopes] = useState<McpAccessScope[]>([]);
  const shopConnectionUrl = `${readApiBaseUrl()}/mcp?shopId=${encodeURIComponent(businessId)}`;

  function selectModelLab(nextModelLabId: ModelLabId) {
    setModelLabId(nextModelLabId);
    const selected = modelLabOptions.find((option) => option.id === nextModelLabId);
    setMcpTokenName(`${selected?.label ?? "Cloud AI"} shop connection`);
    setNewMcpAccessToken("");
    setNewMcpAccessScopes([]);
  }

  async function loadMcpTokens() {
    try {
      const response = await getJson<{ tokens: McpAccessTokenSummary[] }>("/v1/mcp/tokens");
      setMcpTokens(response.tokens);
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function createMcpToken() {
    const scopes: McpAccessScope[] = [
      ...(mcpReadEnabled ? (["mcp:read"] as const) : []),
      ...(mcpActEnabled ? (["mcp:act"] as const) : [])
    ];
    if (scopes.length === 0) {
      setProfileMessage("Select at least one MCP permission.");
      return;
    }
    try {
      if (mcpActEnabled) {
        await postJson<{ verified: boolean }>("/auth/pin/verify", { pin: mcpPin });
      }
      const created = await postJson<McpAccessTokenCreated>("/v1/mcp/tokens", {
        name: mcpTokenName,
        scopes,
        shopId: businessId,
        expiresInSeconds: 2_592_000
      });
      setNewMcpAccessToken(created.accessToken);
      setNewMcpAccessScopes(created.token.scopes);
      setMcpPin("");
      await loadMcpTokens();
      setProfileMessage(
        "Cloud AI shop connection created. Copy its API configuration into your model-lab project."
      );
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  async function revokeMcpToken(tokenId: string) {
    try {
      await deleteJson<McpAccessTokenSummary>(`/v1/mcp/tokens/${encodeURIComponent(tokenId)}`);
      await loadMcpTokens();
      setProfileMessage("MCP token revoked.");
    } catch (error) {
      setProfileMessage(getErrorMessage(error));
    }
  }

  useEffect(() => {
    void loadMcpTokens();
  }, [accountId, businessId]);

  const selectedModelLab =
    modelLabOptions.find((option) => option.id === modelLabId) ?? modelLabOptions[0];
  const selectedModelLabSetup = modelLabSetup(modelLabId, shopConnectionUrl, newMcpAccessToken);
  const connectionBundle = [
    `Soko shop: ${businessId}`,
    `Provider: ${selectedModelLab.label}`,
    `Permissions: ${[
      ...(newMcpAccessScopes.includes("mcp:read") ? ["read shop data"] : []),
      ...(newMcpAccessScopes.includes("mcp:act") ? ["propose confirmed actions"] : [])
    ].join(", ")}`,
    "",
    selectedModelLabSetup.configuration
  ].join("\n");

  return (
    <div className="record-form cloud-model-connection">
      <div className="section-heading">
        <p className="eyebrow">Cloud model account</p>
        <h4>Connect your shop to a major AI lab</h4>
        <p>
          Create a shop-bound remote MCP connection for the model-lab developer account you already
          use. Soko generates the provider-ready API configuration and never asks for that account's
          password or API key.
        </p>
      </div>
      <div className="model-lab-grid" aria-label="Supported cloud AI accounts">
        {modelLabOptions.map((option) => (
          <button
            className={modelLabId === option.id ? "selected" : "secondary"}
            type="button"
            aria-pressed={modelLabId === option.id}
            key={option.id}
            onClick={() => selectModelLab(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <label>
        Connection name
        <input value={mcpTokenName} onChange={(event) => setMcpTokenName(event.target.value)} />
      </label>
      <div className="checkbox-list">
        <label>
          <input
            type="checkbox"
            checked={mcpReadEnabled}
            onChange={(event) => setMcpReadEnabled(event.target.checked)}
          />
          Let the model read this shop's catalogue and sync changes
        </label>
        <label>
          <input
            type="checkbox"
            checked={mcpActEnabled}
            onChange={(event) => setMcpActEnabled(event.target.checked)}
          />
          Let the model propose shop actions through Soko's confirmation gates
        </label>
      </div>
      {mcpActEnabled ? (
        <label>
          Owner PIN
          <input
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            value={mcpPin}
            onChange={(event) => setMcpPin(event.target.value)}
            placeholder="Required for action access"
          />
        </label>
      ) : null}
      <button
        type="button"
        disabled={
          pendingProfileAction !== null ||
          mcpTokenName.trim().length < 3 ||
          (mcpActEnabled && !/^\d{4}$/.test(mcpPin))
        }
        onClick={() => void runProfileAction("mcp-create", createMcpToken)}
      >
        Create 30-day shop connection
      </button>
      {newMcpAccessToken.length > 0 ? (
        <div className="model-lab-connection-card" role="status">
          <strong>{selectedModelLab.label} connection details</strong>
          <p>{selectedModelLabSetup.instructions} The secret is shown only once.</p>
          <span>Shop API link</span>
          <code>{shopConnectionUrl}</code>
          <div className="ai-model-card-actions">
            <button
              className="secondary"
              type="button"
              onClick={() => void copyStorefrontValue(shopConnectionUrl, "Shop API link")}
            >
              Copy shop link
            </button>
          </div>
          <span>30-day connection secret — shown only once</span>
          <code>{newMcpAccessToken}</code>
          <span>{selectedModelLab.label} API configuration</span>
          <pre>
            <code>{selectedModelLabSetup.configuration}</code>
          </pre>
          <div className="ai-model-card-actions">
            <button
              className="secondary"
              type="button"
              onClick={() => void copyStorefrontValue(newMcpAccessToken, "Connection secret")}
            >
              Copy secret
            </button>
            <button
              type="button"
              onClick={() => void copyStorefrontValue(connectionBundle, "API configuration")}
            >
              Copy API configuration
            </button>
          </div>
        </div>
      ) : null}
      <div className="connected-social-list" aria-label="Cloud AI shop connections">
        {mcpTokens.length === 0 ? <p className="shell-note">No cloud AI connections yet.</p> : null}
        {mcpTokens.map((token) => (
          <article className="connected-social-card" key={token.id}>
            <div>
              <span>{token.scopes.join(" · ")}</span>
              <strong>{token.name}</strong>
              <p>
                {token.revokedAt !== null
                  ? "Revoked"
                  : Date.parse(token.expiresAt) <= Date.now()
                    ? "Expired"
                    : `Connected · expires ${formatDate(token.expiresAt)}`}
              </p>
            </div>
            <div className="connected-social-meta">
              <span>Created: {formatDate(token.createdAt)}</span>
              <span>
                Last used: {token.lastUsedAt === null ? "—" : formatDate(token.lastUsedAt)}
              </span>
            </div>
            <button
              className="secondary"
              type="button"
              disabled={token.revokedAt !== null || pendingProfileAction !== null}
              onClick={() => void runProfileAction("mcp-revoke", () => revokeMcpToken(token.id))}
            >
              Revoke
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
