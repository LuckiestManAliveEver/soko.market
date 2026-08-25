import type { SokoMode } from "./app-shell";
import { StackedModule } from "./StackedModule";

interface ChatComposerActionsProps {
  draftHasText: boolean;
  mode: SokoMode;
  open: boolean;
  onAttachFiles: () => void;
  onClose: () => void;
  onOpenCommand: () => void;
  onRecordVoice: () => void;
  onSendSms: () => void;
  onShareApps: () => void;
  onTakePhoto: () => void;
}

export function ChatComposerActions({
  draftHasText,
  mode,
  open,
  onAttachFiles,
  onClose,
  onOpenCommand,
  onRecordVoice,
  onSendSms,
  onShareApps,
  onTakePhoto
}: ChatComposerActionsProps) {
  return (
    <StackedModule
      className="composer-actions-module"
      moduleId="composer-message-actions"
      open={open}
      title="More message actions"
      onClose={onClose}
    >
      <div className="composer-action-grid">
        {mode === "seller" ? (
          <button
            type="button"
            aria-label="Take photo"
            data-testid="seller-photo-button"
            onClick={onTakePhoto}
          >
            <span className="camera-icon" aria-hidden="true" />
            <span>Camera</span>
          </button>
        ) : null}
        <button type="button" aria-label="Photos or files" onClick={onAttachFiles}>
          <span className="attach-icon" aria-hidden="true" />
          <span>Photos or files</span>
        </button>
        <button type="button" aria-label="Record voice" onClick={onRecordVoice}>
          <span className="mic-icon" aria-hidden="true" />
          <span>Voice</span>
        </button>
        {mode === "seller" ? (
          <button type="button" aria-label="Open command" onClick={onOpenCommand}>
            <span className="composer-command-icon" aria-hidden="true">
              #
            </span>
            <span>Command</span>
          </button>
        ) : null}
        <button type="button" aria-label="Send as SMS" disabled={!draftHasText} onClick={onSendSms}>
          <span className="composer-sms-icon" aria-hidden="true">
            SMS
          </span>
          <span>Send as SMS</span>
        </button>
        <button
          type="button"
          aria-label="Share to apps"
          disabled={!draftHasText}
          onClick={onShareApps}
        >
          <span className="composer-share-icon" aria-hidden="true">
            ↗
          </span>
          <span>Share to apps</span>
        </button>
      </div>
    </StackedModule>
  );
}
