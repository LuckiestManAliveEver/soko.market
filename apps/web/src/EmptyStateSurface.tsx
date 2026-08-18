export interface EmptyStateSurfaceProps {
  title: string;
  body: string;
  onChat: () => void;
  actionLabel?: string;
}

export function EmptyStateSurface({
  title,
  body,
  onChat,
  actionLabel = "Draft in chat"
}: EmptyStateSurfaceProps) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{body}</p>
      <button type="button" onClick={onChat}>
        {actionLabel}
      </button>
    </div>
  );
}
