import type { AccountShopSummary } from "@soko/shared-types";

import type { ActiveBusiness } from "./soko-application-shared";

export interface YourShopsPanelProps {
  shops: AccountShopSummary[];
  business: ActiveBusiness;
  onSwitchBusiness: (shop: AccountShopSummary) => void;
}

export function YourShopsPanel({ shops, business, onSwitchBusiness }: YourShopsPanelProps) {
  if (shops.length <= 1) return null;

  return (
    <section className="record-form" aria-label="Your shops">
      <div className="section-heading">
        <p className="eyebrow">Account</p>
        <h3>Your shops</h3>
      </div>
      <div className="connected-social-list" role="list">
        {shops.map((shop) => (
          <article className="connected-social-card" role="listitem" key={shop.business.id}>
            <div>
              <span>{shop.business.sokoId}</span>
              <strong>{shop.business.name}</strong>
              <p>{shop.membership.role}</p>
            </div>
            {shop.business.id === business.id ? (
              <span className="shell-note">Current shop</span>
            ) : (
              <button type="button" onClick={() => onSwitchBusiness(shop)}>
                Switch to this shop
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
