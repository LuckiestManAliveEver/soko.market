import type {
  AgentDefinition,
  AgentRouteSummary,
  AiModelSummary,
  AuthenticatedActorView,
  BuyCheckoutItemInput,
  BuyFeedSummary,
  ClientWorkspaceFileTransfer,
  BusinessReportSummary,
  BusinessSummary,
  CatalogueQueryResult,
  ChannelProvider,
  CustomerSummary,
  DocumentImportJobSummary,
  FulfillmentStatus,
  InvoiceSummary,
  LogisticsSummary,
  MembershipSummary,
  ModelExecutionTarget,
  NativeRuntimeBindingSummary,
  NativeRuntimeActivationInput,
  NativeDefaultRuntimeProvisioningInput,
  NativeDefaultRuntimeProvisioningResult,
  ResolvedNativeRuntimeBinding,
  NotificationInbox,
  ProductFieldDefinition,
  ProductFieldSchemaSummary,
  ProductSummary,
  PurchaseReceiptSummary,
  ReceiptOCRJobSummary,
  RuntimeContextSummary,
  RuntimeModelProvider,
  SecurityReviewSummary,
  SupplierSummary,
  TrustedMessageAttachmentReference,
  UnifiedCheckoutSummary,
  WorkspaceDeliverResult
} from "@soko/shared-types";
import type { BusinessPermission, InvoiceInput, PaymentInput } from "@soko/business-core";

import type { ModelRuntimeAdapter } from "../../../inference/model-runtime.js";
import type { SessionRecord } from "../../store.js";

export interface AgentRuntimeDomainDeps {
  // DB-hosted model catalog (see infra/db/migrations/071_platform_catalog.sql,
  // Cp2Store.modelCatalog) - the source of truth every aiModelRegistry.find()/.filter() call in
  // this domain used to read directly now goes through these instead, so a platform operator's
  // catalog edit is visible without a redeploy.
  listModelCatalog: () => AiModelSummary[];
  resolveCatalogModel: (modelId: string) => AiModelSummary | undefined;
  // Same for the built-in agent template catalog (Cp2Store.agentCatalog) - always resolves to
  // something usable (falls back to the hardcoded defaultAgentDefinition), since a business must
  // always be able to bootstrap a default agent profile even if the catalog row was deleted.
  resolveAgentCatalogEntry: (agentDefinitionId: string) => AgentDefinition;
  requireAuthorizedSession: (
    sessionId: string | null,
    businessId: string,
    permission: BusinessPermission,
    now?: Date
  ) => AuthenticatedActorView;
  requirePinVerifiedSession: (sessionId: string | null, now: Date) => AuthenticatedActorView;
  recordAuditEvent: (input: {
    type: string;
    aggregateType: string;
    aggregateId: string;
    actorId: string;
    occurredAt: string;
    payload: Record<string, unknown>;
  }) => void;
  requireMembership: (businessId: string, userId: string) => MembershipSummary;
  requireBusiness: (businessId: string) => BusinessSummary;
  buildRuntimeContext: (businessId: string, userId: string) => RuntimeContextSummary;
  imageForProduct: (product: ProductSummary) => string | null;
  importsForBusiness: (businessId: string) => DocumentImportJobSummary[];
  requireDocumentImport: (businessId: string, importJobId: string) => DocumentImportJobSummary;
  suppliersForBusiness: (businessId: string) => SupplierSummary[];
  purchaseReceipts: Map<string, PurchaseReceiptSummary>;
  queryCatalogue: (input: {
    sessionId: string | null;
    businessId: string;
    query: string;
    now?: Date;
  }) => CatalogueQueryResult;
  listProducts: (input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }) => ProductSummary[];
  listInvoices: (input: { sessionId: string | null; businessId: string; now?: Date }) => unknown;
  listCustomerDebts: (input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }) => unknown;
  getBusinessReport: (input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }) => BusinessReportSummary;
  listNotifications: (input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }) => NotificationInbox;
  getSecurityReview: (input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }) => SecurityReviewSummary;
  createAgentRoute: (input: {
    sessionId: string | null;
    requestText: string;
    targetNodeId?: string | null;
    now?: Date;
  }) => AgentRouteSummary;
  searchBuyFeed: (input: { sessionId: string | null; query: string; now?: Date }) => BuyFeedSummary;
  createUnifiedCheckout: (input: {
    sessionId: string | null;
    items: BuyCheckoutItemInput[];
    sellerConversationId?: string | null;
    now?: Date;
  }) => UnifiedCheckoutSummary;
  getProductFieldSchema: (input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }) => ProductFieldSchemaSummary;
  saveProductFieldSchema: (input: {
    sessionId: string | null;
    businessId: string;
    fields: ProductFieldDefinition[];
    now?: Date;
  }) => ProductFieldSchemaSummary;
  createProduct: (input: {
    sessionId: string | null;
    businessId: string;
    product: {
      name: string;
      sku: string | null;
      unit: string;
      quantity: number;
      sellingPrice?: number | null;
    };
    now?: Date;
  }) => ProductSummary;
  updateProduct: (input: {
    sessionId: string | null;
    businessId: string;
    productId: string;
    product: {
      name: string;
      sku: string | null;
      unit: string;
      quantity: number;
      buyingPrice: number | null;
      sellingPrice: number | null;
    };
    now?: Date;
  }) => ProductSummary;
  adjustProductStock: (input: {
    sessionId: string | null;
    businessId: string;
    productId: string;
    adjustment: { quantityAfter: number; reason?: string | null };
    now?: Date;
  }) => unknown;
  deleteProduct: (input: {
    sessionId: string | null;
    businessId: string;
    productId: string;
    now?: Date;
  }) => unknown;
  createCustomer: (input: {
    sessionId: string | null;
    businessId: string;
    customer: {
      name: string;
      phone: string | null;
      email: string | null;
      notes: string | null;
    };
    now?: Date;
  }) => CustomerSummary;
  updateCustomer: (input: {
    sessionId: string | null;
    businessId: string;
    customerId: string;
    customer: { name: string; phone: string | null; email: string | null; notes: string | null };
    now?: Date;
  }) => CustomerSummary;
  createSupplier: (input: {
    sessionId: string | null;
    businessId: string;
    supplier: { name: string; phone: string | null; email: string | null; notes: string | null };
    now?: Date;
  }) => SupplierSummary;
  updateSupplier: (input: {
    sessionId: string | null;
    businessId: string;
    supplierId: string;
    supplier: { name: string; phone: string | null; email: string | null; notes: string | null };
    now?: Date;
  }) => SupplierSummary;
  createInvoice: (input: {
    sessionId: string | null;
    businessId: string;
    invoice: InvoiceInput;
    now?: Date;
  }) => InvoiceSummary;
  recordPayment: (input: {
    sessionId: string | null;
    businessId: string;
    payment: PaymentInput;
    now?: Date;
  }) => unknown;
  updateLogisticsStatus: (input: {
    sessionId: string | null;
    businessId: string;
    logisticsId: string;
    status: { status: FulfillmentStatus; note?: string | null };
    now?: Date;
  }) => LogisticsSummary;
  listPurchaseReceipts: (input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }) => PurchaseReceiptSummary[];
  listReceiptOCRJobs: (input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }) => ReceiptOCRJobSummary[];
  createReceiptOCRJob: (input: {
    sessionId: string | null;
    businessId: string;
    sourceFileName: string;
    contentType: string;
    extractedText: string;
    now?: Date;
  }) => unknown;
  confirmReceiptOCRJob: (input: {
    sessionId: string | null;
    businessId: string;
    ocrJobId: string;
    supplierId?: string | null;
    salesAgentId?: string | null;
    createSupplier?: boolean;
    createSalesAgent?: boolean;
    now?: Date;
  }) => PurchaseReceiptSummary;
  correctReceiptOCRJob: (input: {
    sessionId: string | null;
    businessId: string;
    ocrJobId: string;
    extractedText: string;
    now?: Date;
  }) => unknown;
  cancelReceiptOCRJob: (input: {
    sessionId: string | null;
    businessId: string;
    ocrJobId: string;
    now?: Date;
  }) => unknown;
  confirmProductImport: (input: {
    sessionId: string | null;
    businessId: string;
    importJobId: string;
    now?: Date;
  }) => unknown;
  confirmSupplierImport: (input: {
    sessionId: string | null;
    businessId: string;
    importJobId: string;
    now?: Date;
  }) => unknown;
  sendChannelMessage: (input: {
    sessionId: string | null;
    businessId: string;
    customerId?: string;
    customerName?: string;
    conversationId?: string;
    provider?: ChannelProvider;
    mailboxId?: string;
    subject?: string;
    replyToMessageId?: string;
    attachments?: TrustedMessageAttachmentReference[];
    text: string;
    idempotencyKey: string;
    now?: Date;
  }) => Promise<unknown>;
  deliverWorkspaceFile: (input: {
    sessionId: string | null;
    businessId: string;
    conversationId: string;
    requestedPaths: string[];
    transferredFiles?: ClientWorkspaceFileTransfer[];
    caption?: string;
    toolCallId: string;
    now?: Date;
  }) => Promise<WorkspaceDeliverResult>;
  products: Map<string, ProductSummary>;
  customers: Map<string, CustomerSummary>;
  invoices: Map<string, InvoiceSummary>;
  sessions: Map<string, SessionRecord>;
  businesses: Map<string, BusinessSummary>;
  // null means the native runtime graph has nothing usable for this conversation right now (no
  // model configured, nothing currently available, etc.) - callers fall back to the legacy
  // agent-model-binding path rather than treating it as an error. See resolveNativeRuntimeBinding
  // in store.ts and docs/architecture/provider-neutral-runtime.md §5.
  //
  // businessId is the caller's already-authorized shop (from the request path/session, never the
  // client body) - the implementation must reject a conversationId that belongs to another shop
  // rather than silently resolving that shop's binding/model/host for this request.
  resolveNativeRuntimeBinding: (
    conversationId: string,
    businessId: string
  ) => ResolvedNativeRuntimeBinding | null;
  activateVerifiedRuntimeBinding: (
    input: NativeRuntimeActivationInput
  ) => NativeRuntimeBindingSummary;
  ensureDefaultRuntimeBinding: (
    input: NativeDefaultRuntimeProvisioningInput
  ) => NativeDefaultRuntimeProvisioningResult;
  deactivateRuntimeBinding: (input: {
    businessId: string;
    accountId: string;
    agentId: string;
    updatedBy: string;
    now: Date;
  }) => string | null;
  modelRuntimeAdapterResolver?: (input: {
    modelId: string;
    executionTarget: ModelExecutionTarget;
    agentId: string;
    shopId: string;
  }) => ModelRuntimeAdapter | undefined;
  runtimeModelProviderResolver?: (modelId: string) => RuntimeModelProvider | undefined;
  runtimeModelProvider?: RuntimeModelProvider;
}
