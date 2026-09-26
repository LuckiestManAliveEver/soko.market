import { shopHubCopy, shopHubLanguage, type ShopHubLanguage } from "./shop-hub-copy";
import { ShopHubIcon } from "./ShopHubIcon";

// Static pieces of the Shop Hub: the chat entry card and the loading skeleton. ShopHub itself is
// lazy-loaded into the workspace drawer (ChatSurface.tsx), so the owner route only carries these.

/** The compact entry the welcome "owner controls" message shows in chat. */
export function ShopHubEntryCard({
  language = shopHubLanguage(),
  onOpen
}: {
  language?: ShopHubLanguage;
  onOpen: () => void;
}) {
  const copy = shopHubCopy(language);
  return (
    <section className="generated-card-message shop-hub-entry" aria-label={copy.entryTitle}>
      <button type="button" className="shop-hub-entry-button" onClick={onOpen}>
        <span className="shop-hub-kiondo">
          <ShopHubIcon icon="kiondo" />
        </span>
        <span>
          <strong>{copy.entryTitle}</strong>
          <small>{copy.entryBody}</small>
        </span>
      </button>
    </section>
  );
}

/** Same tile geometry as the loaded hub, so swapping it in never shifts the layout. */
export function ShopHubSkeleton({ label }: { label: string }) {
  return (
    <div className="shop-hub-skeleton" aria-busy="true" aria-label={label}>
      {[0, 1].map((section) => (
        <div className="shop-hub-section" key={section}>
          <span className="shop-hub-skeleton-label" />
          <div className="shop-hub-grid">
            {[0, 1, 2, 3].map((tile) => (
              <span className="shop-hub-tile shop-hub-skeleton-tile" key={tile} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
