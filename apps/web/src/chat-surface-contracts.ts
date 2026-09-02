import type { ChangeEvent, ReactNode } from "react";

import type {
  BuyFeedSummary,
  BuyResultSummary,
  ChannelEndpointSummary,
  ChannelProvider,
  ConversationInboxItem,
  MessageHandoffStatus,
  ProductFieldDefinition,
  RecycleBinStatusSummary
} from "@soko/shared-types";

import type { ChatAttachment, ChatMessage, ShellView, SokoMode } from "./app-shell";
import type {
  BusinessReportSummary,
  BuyCartItem,
  ContactPickerContact,
  InvoiceSummary,
  NetworkGraphSummary,
  OAuthProviderSummary,
  ProductFieldDraft,
  ProductFormState,
  ProductSummary,
  PublicStorefrontSummary,
  ShopPresenceStatus,
  SocialSignupProvider,
  SyncQueueSummary
} from "./soko-application-shared";

export interface ChatSurfaceProps {
  activeConversationId: string | null;
  chatDraft: string;
  initialEmailSubject: string;
  channelEndpoints: ChannelEndpointSummary[];
  children: ReactNode;
  conversations: ConversationInboxItem[];
  customerCount: number;
  invoiceCount: number;
  invoices: InvoiceSummary[];
  messages: ChatMessage[];
  isInboxOpen: boolean;
  isContactTyping: boolean;
  isConfirming: boolean;
  isSending: boolean;
  isBrowserGenerating: boolean;
  securityLabel: string;
  replyToMessageId: string | null;
  marketplaceIntroComplete: boolean;
  marketplaceShortcutOpen: boolean;
  networkGraph: NetworkGraphSummary | null;
  notificationCount: number;
  oauthProviders: OAuthProviderSummary[];
  oauthProvidersLoaded: boolean;
  pendingAttachments: ChatAttachment[];
  productForm: ProductFormState;
  productFields: ProductFieldDefinition[];
  productCount: number;
  products: ProductSummary[];
  publicStorefronts: PublicStorefrontSummary[];
  publicStorefrontsLoading: boolean;
  report: BusinessReportSummary | null;
  shopPresenceStatus: ShopPresenceStatus;
  syncSummary: SyncQueueSummary;
  workspaceOpen: boolean;
  buyFeed: BuyFeedSummary | null;
  isSearchingBuyFeed: boolean;
  buyCart: BuyCartItem[];
  isCheckingOut: boolean;
  onAttachmentChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSellerPhotoCapture: (file: File) => void;
  onStatusBroadcastPosted: (statusBroadcastId: string) => void;
  onSearchBuyFeed: (query: string) => void;
  onAddToCart: (result: BuyResultSummary) => void;
  onRemoveFromCart: (cartItemId: string) => void;
  onCheckout: () => void;
  onBackToChat: () => void;
  onCloseMarketplace: () => void;
  onCloseWorkspace: () => void;
  onDraftChange: (draft: string) => void;
  onSelectConversation: (conversationId: string) => void;
  onCreateConversation: (recipient: string, title: string) => void;
  onCreateAgentSession: (title?: string) => void;
  onRequireSignIn: () => void;
  onBrowseAsGuest: () => void;
  onSignUp: () => void;
  onLogIn: () => void;
  onRefreshPublicStorefronts: () => void;
  onConversationPreference: (
    conversationId: string,
    preference: "archive" | "mute" | "pin"
  ) => void;
  recycleBin: RecycleBinStatusSummary | null;
  onDeleteConversation: (conversationId: string) => void;
  onRestoreConversation: (conversationId: string) => void;
  onLoadRecycleBin: () => void;
  onEmptyRecycleBin: (conversationIds?: string[]) => void;
  onEnableNotifications: () => void;
  onInboxOpenChange: (open: boolean) => void;
  onReply: (messageId: string) => void;
  onCancelReply: () => void;
  onEditMessage: (messageId: string, text: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onReactMessage: (messageId: string, reaction: string | null) => void;
  onAgentFeedback: (messageId: string, correct: boolean) => void;
  onForwardMessage: (messageId: string, conversationId: string) => void;
  onRetryMessages: () => void;
  onNavigate: (view: ShellView) => void;
  onOpenWorkspace: () => void;
  onModeChange: (mode: SokoMode) => void;
  onOpenAgentProfile: () => void;
  onCompleteMarketplaceIntro: () => void;
  onProductEdit: (product: ProductSummary) => void;
  onProductFieldsSave: (fields: ProductFieldDraft[]) => void;
  onProductFormChange: (form: ProductFormState) => void;
  onProductRemove: (productId: string) => void;
  onProductReset: () => void;
  onProductSave: () => Promise<boolean>;
  onNetworkDisconnectSource: (sourceId: string) => void;
  onNetworkPhoneContactsSync: (
    selectedContacts: ContactPickerContact[]
  ) => Promise<NetworkGraphSummary | null>;
  onNetworkInviteContacts: (selectedContacts: ContactPickerContact[]) => Promise<number>;
  onNetworkProviderOAuth: (provider: SocialSignupProvider) => Promise<void>;
  onNetworkRefresh: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onStatusChange: (status: ShopPresenceStatus) => void;
  onConfirm: (confirmationToken: string) => void;
  onSend: (draft: string, provider?: ChannelProvider, subject?: string, invoiceId?: string) => void;
  onCancelGeneration: () => void;
  onSmsHandoff: (status: MessageHandoffStatus, normalizedErrorCode: string | null) => void;
  onPlatformHandoff: (status: MessageHandoffStatus, normalizedErrorCode: string | null) => void;
}
