import type { BuyResultSummary } from "@soko/shared-types";

/**
 * One row in the BUY feed - a contact's status or a catalogue listing, rendered distinctly by
 * sourceKind (never merged into a generic "product result" look) so a buyer can tell at a glance
 * whether they're looking at a friend's status or a shop's catalogue. Sibling to
 * StatusBroadcastCard/UnifiedCartSummary/FulfilmentSplitCard - same "one card per commerce
 * object" convention.
 */
export function StatusResultCard(props: {
  result: BuyResultSummary;
  isAuthenticated: boolean;
  onAddToCart: (result: BuyResultSummary) => void;
}) {
  const { result } = props;
  return (
    <div className="buy-result-card">
      <span className={`buy-source-badge buy-source-${result.sourceKind}`}>
        {result.sourceKind === "contact" ? "From your contact" : "Shop"}: {result.sourceLabel}
      </span>
      <strong>{result.title}</strong>
      <span>{result.price === null ? "Price on request" : `KSh ${result.price}`}</span>
      {props.isAuthenticated ? (
        <button type="button" onClick={() => props.onAddToCart(result)}>
          Add to cart
        </button>
      ) : null}
    </div>
  );
}
