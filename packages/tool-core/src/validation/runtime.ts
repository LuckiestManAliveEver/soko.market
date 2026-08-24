import {
  invalid,
  valid,
  type RuntimeToolName,
  type ValidationResult
} from "../contracts/runtime.js";

export function validateRuntimeToolInput(
  toolName: RuntimeToolName,
  input: Record<string, unknown>
): ValidationResult {
  switch (toolName) {
    case "products.list":
    case "invoices.list":
    case "reports.summary":
    case "notifications.list":
    case "compliance.review":
    case "commerce.search":
    case "payments.debtors":
    case "receipt.review":
    case "receipt.lookup":
    case "receipt.list":
    case "unknown.clarify":
      return valid();

    case "network.route":
      return typeof input.requestText === "string" && input.requestText.trim().length > 0
        ? valid()
        : invalid("What should I look for through your network?");

    case "commerce.checkout": {
      const items = Array.isArray(input.items) ? input.items : [];
      const errors: string[] = [];
      if (items.length === 0 || items.length > 100) {
        errors.push("Checkout needs between one and 100 canonical buy-feed items.");
      }
      for (const [index, item] of items.entries()) {
        const record =
          item !== null && typeof item === "object" ? (item as Record<string, unknown>) : null;
        if (
          record === null ||
          !["catalogue", "contact", "marketplace_connector"].includes(String(record.sourceKind)) ||
          typeof record.sourceId !== "string" ||
          record.sourceId.trim().length === 0 ||
          typeof record.sourceLabel !== "string" ||
          record.sourceLabel.trim().length === 0 ||
          typeof record.title !== "string" ||
          record.title.trim().length === 0 ||
          typeof record.quantity !== "number" ||
          !Number.isInteger(record.quantity) ||
          record.quantity < 1
        ) {
          errors.push(`Checkout item ${index + 1} is not a canonical buy-feed item.`);
        }
      }
      return errors.length === 0 ? valid() : invalid(...errors);
    }

    case "receipt.scan": {
      const extractedText =
        typeof input.extractedText === "string" ? input.extractedText.trim() : "";
      return extractedText.length > 0
        ? valid()
        : invalid("Attach a receipt and provide its trusted OCR text before I scan it.");
    }

    case "receipt.confirm":
      return typeof input.ocrJobId === "string" && input.ocrJobId.trim().length > 0
        ? valid()
        : invalid("Which receipt scan should I confirm?");

    case "receipt.correct": {
      const ocrJobId = typeof input.ocrJobId === "string" ? input.ocrJobId.trim() : "";
      const extractedText =
        typeof input.extractedText === "string" ? input.extractedText.trim() : "";
      const errors: string[] = [];
      if (ocrJobId.length === 0) errors.push("Which receipt scan should I correct?");
      if (extractedText.length === 0) errors.push("What should the corrected receipt text be?");
      return errors.length === 0 ? valid() : invalid(...errors);
    }

    case "receipt.cancel":
      return typeof input.ocrJobId === "string" && input.ocrJobId.trim().length > 0
        ? valid()
        : invalid("Which receipt scan should I cancel?");

    case "document_import.confirm":
      return typeof input.importJobId === "string" && input.importJobId.trim().length > 0
        ? valid()
        : invalid("Which document import should I add?");

    case "workspace.deliver": {
      const pathIsValid = typeof input.path === "string" && input.path.trim().length > 0;
      const additionalPathsAreValid =
        input.additionalPaths === undefined ||
        (Array.isArray(input.additionalPaths) &&
          input.additionalPaths.length <= 9 &&
          input.additionalPaths.every(
            (path) => typeof path === "string" && path.trim().length > 0
          ));
      return pathIsValid && additionalPathsAreValid
        ? valid()
        : invalid("Choose between one and ten workspace files to deliver.");
    }

    case "messaging.send": {
      const text = typeof input.text === "string" ? input.text.trim() : "";
      const customerId = typeof input.customerId === "string" ? input.customerId.trim() : "";
      const conversationId =
        typeof input.conversationId === "string" ? input.conversationId.trim() : "";
      const customerName = typeof input.customerName === "string" ? input.customerName.trim() : "";
      const provider = typeof input.provider === "string" ? input.provider.trim() : "";
      const subject = typeof input.subject === "string" ? input.subject.trim() : "";
      const errors: string[] = [];
      if (text.length === 0 || text.length > 4000) {
        errors.push("A message between 1 and 4000 characters is required.");
      }
      if (customerId === "" && conversationId === "" && customerName === "") {
        errors.push("Choose a canonical customer or conversation before sending.");
      }
      if (provider === "email" && (subject.length === 0 || subject.length > 200)) {
        errors.push("Email requires a subject between 1 and 200 characters.");
      }
      if (input.attachments !== undefined) {
        if (!Array.isArray(input.attachments) || input.attachments.length > 3) {
          errors.push("Email supports at most three trusted attachment references.");
        } else if (
          input.attachments.some(
            (attachment) =>
              attachment === null ||
              typeof attachment !== "object" ||
              (attachment as Record<string, unknown>).resourceType !== "invoice" ||
              typeof (attachment as Record<string, unknown>).resourceId !== "string"
          )
        ) {
          errors.push("Email attachments must reference trusted invoice resources.");
        }
      }
      return errors.length === 0 ? valid() : invalid(...errors);
    }

    case "product.create": {
      const errors: string[] = [];
      const name = typeof input.name === "string" ? input.name.trim() : "";
      const unit = typeof input.unit === "string" ? input.unit.trim() : "";
      const quantity = Number(input.quantity ?? 0);

      if (name.length === 0) {
        errors.push("Product name is required before a product can be drafted.");
      }

      if (unit.length === 0) {
        errors.push("Product unit is required before a product can be drafted.");
      }

      if (!Number.isFinite(quantity) || quantity < 0) {
        errors.push("Product quantity must be a non-negative number.");
      }

      return errors.length === 0 ? valid() : invalid(...errors);
    }

    case "product.update": {
      const productName = typeof input.productName === "string" ? input.productName.trim() : "";
      const errors: string[] = [];

      if (productName.length === 0) {
        errors.push("Which product should I edit?");
      }

      const changedFields = ["name", "unit", "quantity", "buyingPrice", "sellingPrice"].filter(
        (field) => input[field] !== undefined
      );
      if (changedFields.length === 0) {
        errors.push("Which product details should I change?");
      }
      for (const field of ["quantity", "buyingPrice", "sellingPrice"] as const) {
        if (
          input[field] !== undefined &&
          (typeof input[field] !== "number" || !Number.isFinite(input[field]) || input[field] < 0)
        ) {
          errors.push(`${field} must be a non-negative number.`);
        }
      }

      return errors.length === 0 ? valid() : invalid(...errors);
    }

    case "product.delete": {
      const productName = typeof input.productName === "string" ? input.productName.trim() : "";
      const productIds = Array.isArray(input.productIds) ? input.productIds : [];

      return productName.length === 0 && productIds.length === 0
        ? invalid("Which product should I delete?")
        : valid();
    }

    case "product.stock_adjust": {
      const productName = typeof input.productName === "string" ? input.productName.trim() : "";
      const quantity = Number(input.quantity);
      const errors: string[] = [];

      if (productName.length === 0) {
        errors.push("Which product stock should I adjust?");
      }

      if (!Number.isFinite(quantity)) {
        errors.push("What quantity change should I apply?");
      }

      return errors.length === 0 ? valid() : invalid(...errors);
    }

    case "product.field.add": {
      const fieldName = typeof input.fieldName === "string" ? input.fieldName.trim() : "";
      const supportedTypes = ["text", "number", "select", "textarea", "yes_no"];
      const errors: string[] = [];
      if (fieldName.length === 0) errors.push("Which product field should I add?");
      if (input.inputType !== undefined && !supportedTypes.includes(String(input.inputType))) {
        errors.push("Product field type must be text, number, select, textarea, or yes_no.");
      }

      return errors.length === 0 ? valid() : invalid(...errors);
    }

    case "product.field.remove": {
      const fieldName = typeof input.fieldName === "string" ? input.fieldName.trim() : "";

      return fieldName.length === 0 ? invalid("Which product field should I remove?") : valid();
    }

    case "customer.create": {
      const name = typeof input.name === "string" ? input.name.trim() : "";

      return name.length === 0
        ? invalid("Customer name is required before a customer can be drafted.")
        : valid();
    }

    case "customer.update": {
      const customerName = typeof input.customerName === "string" ? input.customerName.trim() : "";

      return customerName.length === 0 ? invalid("Which customer should I edit?") : valid();
    }

    case "supplier.create": {
      const name = typeof input.name === "string" ? input.name.trim() : "";

      return name.length === 0
        ? invalid("Supplier name is required before a supplier can be drafted.")
        : valid();
    }

    case "supplier.update": {
      const supplierName = typeof input.supplierName === "string" ? input.supplierName.trim() : "";

      return supplierName.length === 0 ? invalid("Which supplier should I edit?") : valid();
    }

    case "invoice.draft": {
      const customerId = typeof input.customerId === "string" ? input.customerId.trim() : "";
      const customerName = typeof input.customerName === "string" ? input.customerName.trim() : "";
      const items = Array.isArray(input.items) ? input.items : [];
      const errors: string[] = [];
      if (customerId.length === 0 && customerName.length === 0) {
        errors.push("Which customer should receive the invoice?");
      }
      if (items.length === 0) {
        errors.push("Add at least one invoice item with a product, quantity, and unit price.");
      } else {
        for (const [index, item] of items.entries()) {
          const record =
            item !== null && typeof item === "object" ? (item as Record<string, unknown>) : null;
          if (
            record === null ||
            typeof record.productId !== "string" ||
            record.productId.trim().length === 0 ||
            typeof record.quantity !== "number" ||
            !Number.isFinite(record.quantity) ||
            record.quantity <= 0 ||
            typeof record.unitPrice !== "number" ||
            !Number.isFinite(record.unitPrice) ||
            record.unitPrice < 0
          ) {
            errors.push(
              `Invoice item ${index + 1} needs a productId, positive quantity, and non-negative unitPrice.`
            );
          }
        }
      }
      return errors.length === 0 ? valid() : invalid(...errors);
    }

    case "payment.record": {
      const invoiceId = typeof input.invoiceId === "string" ? input.invoiceId.trim() : "";
      const methods = [
        "cash",
        "bank_transfer",
        "mobile_money_manual",
        "card_manual",
        "other_manual"
      ];
      const errors: string[] = [];
      if (invoiceId.length === 0)
        errors.push("Which confirmed invoice should receive the payment?");
      if (typeof input.amount !== "number" || !Number.isFinite(input.amount) || input.amount <= 0) {
        errors.push("Payment amount must be a positive number.");
      }
      if (!methods.includes(String(input.method))) {
        errors.push("Choose a supported payment method.");
      }
      return errors.length === 0 ? valid() : invalid(...errors);
    }

    case "logistics.update_status":
      return typeof input.logisticsId === "string" &&
        input.logisticsId.trim().length > 0 &&
        typeof input.status === "string" &&
        input.status.trim().length > 0
        ? valid()
        : invalid("Logistics runtime draft needs which delivery and the new status.");
  }
}
