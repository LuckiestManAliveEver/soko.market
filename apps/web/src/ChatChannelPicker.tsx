import type { ChannelEndpointSummary, ChannelProvider } from "@soko/shared-types";

import { formatChannelProvider } from "./formatters";
import { StackedModule } from "./StackedModule";

interface ChatChannelPickerProps {
  channelEndpoints: ChannelEndpointSummary[];
  open: boolean;
  selectedProvider: ChannelProvider | null;
  onClose: () => void;
  onSelect: (provider: ChannelProvider | null) => void;
}

function channelAbbreviation(provider: ChannelProvider): string {
  switch (provider) {
    case "email":
      return "@";
    case "telegram":
      return "TG";
    case "whatsapp":
      return "WA";
    case "sms":
    case "native_sms":
      return "SMS";
    case "messenger":
      return "FB";
    case "instagram":
      return "IG";
    case "tiktok":
      return "TT";
    case "x":
      return "X";
    default:
      return "S";
  }
}

function isChannelAvailable(endpoint: ChannelEndpointSummary): boolean {
  return (
    (endpoint.status === "available" ||
      (endpoint.status === "offline" && endpoint.capabilities.includes("SUPPORTS_OFFLINE"))) &&
    endpoint.configured &&
    endpoint.authorized &&
    (endpoint.capabilities.includes("CAN_REPLY") || endpoint.capabilities.includes("CAN_INITIATE"))
  );
}

export function ChatChannelPicker({
  channelEndpoints,
  open,
  selectedProvider,
  onClose,
  onSelect
}: ChatChannelPickerProps) {
  return (
    <StackedModule
      className="composer-actions-module"
      moduleId="composer-channel-picker"
      open={open}
      title="Send via"
      onClose={onClose}
    >
      <div className="composer-action-grid" role="listbox" aria-label="Send via">
        <button
          type="button"
          role="option"
          aria-selected={selectedProvider === null}
          onClick={() => {
            onSelect(null);
            onClose();
          }}
        >
          <span className="channel-picker-icon" aria-hidden="true">
            S
          </span>
          <span>Normal message</span>
        </button>
        {channelEndpoints.map((endpoint) => {
          const available = isChannelAvailable(endpoint);
          return (
            <button
              key={endpoint.channelId}
              type="button"
              role="option"
              aria-selected={selectedProvider === endpoint.provider}
              disabled={!available}
              onClick={() => {
                onSelect(endpoint.provider);
                onClose();
              }}
            >
              <span className="channel-picker-icon" aria-hidden="true">
                {channelAbbreviation(endpoint.provider)}
              </span>
              <span>
                {formatChannelProvider(endpoint.provider)}
                {available ? "" : ` · ${endpoint.status}`}
              </span>
            </button>
          );
        })}
      </div>
    </StackedModule>
  );
}
