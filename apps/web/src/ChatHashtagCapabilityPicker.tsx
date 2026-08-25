interface HashtagCapability {
  description: string;
  hashtag: string;
  inputFields: readonly string[];
  module: string;
  requiresConfirmation: boolean;
  toolName: string;
}

interface ChatHashtagCapabilityPickerProps {
  capabilities: readonly HashtagCapability[];
  query: string;
  onSelect: (draft: string) => void;
}

export function ChatHashtagCapabilityPicker({
  capabilities,
  query,
  onSelect
}: ChatHashtagCapabilityPickerProps) {
  return (
    <section className="hashtag-capability-picker" aria-label="Shop capabilities">
      <header>
        <strong>Call a shop capability</strong>
        <span>Use JSON after the command when it needs multiple inputs.</span>
      </header>
      <div className="hashtag-capability-list">
        {capabilities.length === 0 ? (
          <p>No capability matches #{query}.</p>
        ) : (
          capabilities.map((capability) => (
            <button
              key={capability.toolName}
              type="button"
              onClick={() =>
                onSelect(
                  capability.inputFields.length === 0
                    ? capability.hashtag
                    : `${capability.hashtag} `
                )
              }
            >
              <span>
                <strong>{capability.hashtag}</strong>
                <small>{capability.description}</small>
              </span>
              <small>
                {capability.inputFields.length === 0
                  ? "No input"
                  : `Input: ${capability.inputFields.join(", ")}`}
                {capability.requiresConfirmation ? " · Confirms" : ""}
              </small>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
