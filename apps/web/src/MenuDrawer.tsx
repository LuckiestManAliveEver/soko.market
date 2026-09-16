import { StackedModule } from "./StackedModule";

export interface MenuDrawerProps {
  open: boolean;
  hasBusiness: boolean;
  onClose: () => void;
  onMessageHistory: () => void;
  onShopSettings: () => void;
  onAgentSettings: () => void;
  onAccountSettings: () => void;
  onSetUpShop: () => void;
}

/**
 * Soko Home's hamburger menu drawer: consolidates navigation the hamburger used to trigger
 * directly (Message history) alongside settings destinations that previously had no entry point
 * from the customer-facing shell (Shop/Agent/Account settings all live on the one
 * AgentProfileSurface page, opened here with a hint for which of its SettingsGroups to land on).
 * A pure customer with no shop yet gets a single "Set up your shop" item instead of the three
 * business-scoped ones, since AgentProfileSurface requires an active business to render at all.
 *
 * Built on StackedModule rather than a bespoke slide-in panel so it gets the same tested focus
 * trap, Escape-to-close, and inert-background handling every other panel in the app already has;
 * .menu-drawer-module repositions it from the shared bottom-sheet layout to a left-edge drawer.
 */
export function MenuDrawer({
  open,
  hasBusiness,
  onClose,
  onMessageHistory,
  onShopSettings,
  onAgentSettings,
  onAccountSettings,
  onSetUpShop
}: MenuDrawerProps) {
  return (
    <StackedModule
      moduleId="main-menu"
      className="menu-drawer-module"
      open={open}
      title="Menu"
      onClose={onClose}
    >
      <button className="menu-item" type="button" onClick={onMessageHistory}>
        <span className="menu-item-icon">
          <span className="menu-icon-history" aria-hidden="true" />
        </span>
        Message history
      </button>
      <div className="menu-divider" />
      {hasBusiness ? (
        <>
          <button className="menu-item" type="button" onClick={onShopSettings}>
            <span className="menu-item-icon">
              <span className="shop-entry-icon" aria-hidden="true" />
            </span>
            Shop settings
          </button>
          <button className="menu-item" type="button" onClick={onAgentSettings}>
            <span className="menu-item-icon">
              <span className="menu-icon-agent" aria-hidden="true" />
            </span>
            Agent settings
          </button>
          <div className="menu-divider" />
          <button className="menu-item" type="button" onClick={onAccountSettings}>
            <span className="menu-item-icon">
              <span className="menu-icon-account" aria-hidden="true" />
            </span>
            Account settings
          </button>
        </>
      ) : (
        <button className="menu-item" type="button" onClick={onSetUpShop}>
          <span className="menu-item-icon">
            <span className="shop-entry-icon" aria-hidden="true" />
          </span>
          Set up your shop
        </button>
      )}
    </StackedModule>
  );
}
