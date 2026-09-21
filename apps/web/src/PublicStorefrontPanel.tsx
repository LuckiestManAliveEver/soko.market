import { useEffect, useState } from "react";
import type { CommerceIdentityResolution } from "@soko/shared-types";
import { getJson } from "./api-helpers";
import type { AgentSettings, SupportedLanguage } from "./soko-application-shared";

export interface PublicStorefrontPanelProps {
  business: { sokoId: string };
  storefrontUrl: string;
  ownerLabel: string;
  draftAgent: AgentSettings;
  isEditing: boolean;
  updateAgent: (patch: Partial<AgentSettings>) => void;
  copyStorefrontValue: (value: string, label: string) => Promise<void>;
}

export function PublicStorefrontPanel({
  business,
  storefrontUrl,
  ownerLabel,
  draftAgent,
  isEditing,
  updateAgent,
  copyStorefrontValue
}: PublicStorefrontPanelProps) {
  // Falls back to the raw sokoId while the resolver call is in flight (or if it fails), so this
  // card never regresses to a blank/broken state - see docs/architecture/multiplayer-commerce-audit.md.
  const [publicId, setPublicId] = useState(business.sokoId);

  useEffect(() => {
    let cancelled = false;
    setPublicId(business.sokoId);
    void getJson<CommerceIdentityResolution>(
      `/public/commerce-identities/${encodeURIComponent(business.sokoId)}`
    )
      .then((resolution) => {
        if (!cancelled) setPublicId(resolution.identity.commerceAddress);
      })
      .catch(() => {
        // Keep the sokoId fallback already set above.
      });
    return () => {
      cancelled = true;
    };
  }, [business.sokoId]);

  return (
    <div className="record-form">
      <div className="section-heading">
        <p className="eyebrow">Soko Storefront ID</p>
        <h3>Public storefront</h3>
      </div>
      <div className="soko-id-card">
        <span>Public shop ID</span>
        <strong>{publicId}</strong>
        <p>Print this on packaging, receipts, QR codes, and storefront material.</p>
        <div className="storefront-share-actions">
          <button type="button" onClick={() => void copyStorefrontValue(publicId, "Public ID")}>
            Copy ID
          </button>
          <button
            className="secondary"
            type="button"
            onClick={() => void copyStorefrontValue(storefrontUrl, "Storefront URL")}
          >
            Copy URL
          </button>
        </div>
      </div>
      <label>
        Storefront ID
        <input value={business.sokoId} disabled />
      </label>
      <label>
        Storefront URL
        <input value={storefrontUrl} disabled />
      </label>
      <label>
        Language
        <select
          value={draftAgent.language}
          disabled={!isEditing}
          onChange={(event) => updateAgent({ language: event.target.value as SupportedLanguage })}
        >
          <option value="en">English</option>
          <option value="sw">Swahili</option>
        </select>
      </label>
      <p className="shell-note">{ownerLabel} owns this public storefront assistant.</p>
    </div>
  );
}
