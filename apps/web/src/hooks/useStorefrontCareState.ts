import { useState } from "react";

import type {
  PublicCustomerCareRequestSummary,
  PublicOrderSummary,
  PublicStorefrontMessageSummary
} from "@soko/shared-types";

import { getErrorMessage } from "../chat-message-plumbing";
import { getJson } from "../api-helpers";

interface UseStorefrontCareStateDeps {
  setStatusMessage: (message: string) => void;
  registerReset: (domainKey: string, fn: () => void) => void;
  registerRefresh: (
    domainKey: string,
    views: readonly string[],
    fn: (businessId: string) => Promise<void>
  ) => void;
}

export function useStorefrontCareState(deps: UseStorefrontCareStateDeps) {
  const [storefrontCareRequests, setStorefrontCareRequests] = useState<
    PublicCustomerCareRequestSummary[]
  >([]);
  const [storefrontMessages, setStorefrontMessages] = useState<PublicStorefrontMessageSummary[]>(
    []
  );
  const [storefrontOrders, setStorefrontOrders] = useState<PublicOrderSummary[]>([]);

  async function loadStorefrontInbox(businessId: string) {
    try {
      const [careRequests, messages, orders] = await Promise.all([
        getJson<PublicCustomerCareRequestSummary[]>(
          `/businesses/${businessId}/storefront/customer-care`
        ),
        getJson<PublicStorefrontMessageSummary[]>(`/businesses/${businessId}/storefront/messages`),
        getJson<PublicOrderSummary[]>(`/businesses/${businessId}/storefront/orders`)
      ]);
      setStorefrontCareRequests(careRequests);
      setStorefrontMessages(messages);
      setStorefrontOrders(orders);
    } catch (error) {
      deps.setStatusMessage(getErrorMessage(error));
    }
  }

  deps.registerReset("storefront-care", () => {
    setStorefrontCareRequests([]);
    setStorefrontMessages([]);
    setStorefrontOrders([]);
  });
  deps.registerRefresh("storefront-care", ["home", "notifications"], loadStorefrontInbox);

  return { storefrontCareRequests, storefrontMessages, storefrontOrders, loadStorefrontInbox };
}
