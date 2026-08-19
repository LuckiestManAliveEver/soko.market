import { useEffect, useState } from "react";

import type {
  McpAccessScope,
  McpAccessTokenCreated,
  McpAccessTokenSummary
} from "@soko/shared-types";

import { deleteJson, getJson, postJson } from "./api-helpers";
import { getErrorMessage } from "./chat-message-plumbing";
import { formatDate } from "./formatters";

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
  const [mcpTokenName, setMcpTokenName] = useState("My integration");
  const [mcpReadEnabled, setMcpReadEnabled] = useState(true);
  const [mcpActEnabled, setMcpActEnabled] = useState(false);
  const [mcpPin, setMcpPin] = useState("");
  const [newMcpAccessToken, setNewMcpAccessToken] = useState("");

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
        expiresInSeconds: 86_400
      });
      setNewMcpAccessToken(created.accessToken);
      setMcpPin("");
      await loadMcpTokens();
      setProfileMessage("MCP token created. Copy it now; the secret is shown only once.");
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

  return (
    <div className="record-form shop-profile-card">
      <div className="section-heading">
        <p className="eyebrow">Developer access</p>
        <h3>MCP access tokens</h3>
        <p>
          Create short-lived tokens for trusted AI clients. Action access still preserves Soko
          confirmation gates.
        </p>
      </div>
      <label>
        Token name
        <input value={mcpTokenName} onChange={(event) => setMcpTokenName(event.target.value)} />
      </label>
      <div className="checkbox-list">
        <label>
          <input
            type="checkbox"
            checked={mcpReadEnabled}
            onChange={(event) => setMcpReadEnabled(event.target.checked)}
          />
          Read shops and sync changes
        </label>
        <label>
          <input
            type="checkbox"
            checked={mcpActEnabled}
            onChange={(event) => setMcpActEnabled(event.target.checked)}
          />
          Propose actions through the runtime
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
        Create 24-hour token
      </button>
      {newMcpAccessToken.length > 0 ? (
        <div className="soko-id-card" role="status">
          <span>Copy this secret now—it will not be shown again.</span>
          <code>{newMcpAccessToken}</code>
          <button
            type="button"
            onClick={() => void copyStorefrontValue(newMcpAccessToken, "MCP token")}
          >
            Copy token
          </button>
        </div>
      ) : null}
      <div className="connected-social-list" aria-label="MCP access tokens">
        {mcpTokens.length === 0 ? <p className="shell-note">No MCP tokens yet.</p> : null}
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
                    : `Expires ${formatDate(token.expiresAt)}`}
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
