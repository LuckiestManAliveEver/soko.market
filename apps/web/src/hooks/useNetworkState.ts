import { useState, type ChangeEvent, type Dispatch, type SetStateAction } from "react";

import type { NetworkInviteSummary } from "@soko/shared-types";

import { copyTextToClipboard } from "../misc-browser-utils";
import type { ChatMessage } from "../app-shell";
import { getErrorMessage } from "../chat-message-plumbing";
import { deleteJson, getJson, postJson } from "../api-helpers";
import { contactPickerContactToNetworkContact } from "../NetworkSyncNestedCard";
import {
  contactPickerContactToCustomer,
  createContactsCsv,
  createPhoneNetworkSeed,
  parseContactImportContent
} from "../contacts-import";
import { createPublicStorefrontUrl } from "../sokoid-and-storefront";
import { getUserFacingErrorMessage } from "../user-facing-error";
import type {
  ActiveBusiness,
  AgentRouteSummary,
  ContactPickerContact,
  ContactPickerNavigator,
  CustomerFormState,
  CustomerSummary,
  NetworkGraphSummary,
  NetworkInvitesResponse,
  SocialSignupProvider
} from "../soko-application-shared";

interface UseNetworkStateDeps {
  business: ActiveBusiness | null;
  getCustomers: () => CustomerSummary[];
  loadCustomers: (businessId: string) => Promise<void>;
  setStatusMessage: (message: string) => void;
  registerReset: (domainKey: string, fn: () => void) => void;
  registerRefresh: (
    domainKey: string,
    views: readonly string[],
    fn: (businessId: string) => Promise<void>
  ) => void;
}

// GET /network is served through getCachedJson (api-request-cache.ts), which can resolve to a
// record read straight out of IndexedDB (local-data-repository.ts) written by an older build of
// this app, before touching the network. That cached record's schemaVersion never tracks changes
// to NetworkGraphSummary's shape, so a graph cached before a field was added would otherwise reach
// setNetworkGraph missing arrays entirely, crashing every read site that does `graph.nodes.some(...)`.
export function normalizeNetworkGraph(
  graph: Partial<NetworkGraphSummary> | null | undefined
): NetworkGraphSummary {
  return {
    ownerUserId: graph?.ownerUserId ?? "",
    generatedAt: graph?.generatedAt ?? new Date(0).toISOString(),
    nodes: Array.isArray(graph?.nodes) ? graph.nodes : [],
    edges: Array.isArray(graph?.edges) ? graph.edges : [],
    sources: Array.isArray(graph?.sources) ? graph.sources : [],
    routes: Array.isArray(graph?.routes) ? graph.routes : [],
    ...(Array.isArray(graph?.identityLinks) ? { identityLinks: graph.identityLinks } : {})
  };
}

export function useNetworkState(deps: UseNetworkStateDeps) {
  const [networkGraph, setNetworkGraph] = useState<NetworkGraphSummary | null>(null);
  const [networkInvites, setNetworkInvites] = useState<NetworkInviteSummary[]>([]);

  async function loadNetworkGraph() {
    try {
      setNetworkGraph(
        normalizeNetworkGraph(await getJson<Partial<NetworkGraphSummary>>("/network"))
      );
    } catch (error) {
      deps.setStatusMessage(getErrorMessage(error));
    }
  }

  async function loadNetworkInvites(businessId: string) {
    try {
      setNetworkInvites(
        await getJson<NetworkInviteSummary[]>(`/businesses/${businessId}/network/invites`)
      );
    } catch (error) {
      deps.setStatusMessage(getErrorMessage(error));
    }
  }

  async function syncPhoneNetwork() {
    const contacts = createPhoneNetworkSeed(deps.getCustomers());

    if (contacts.length === 0) {
      deps.setStatusMessage(
        "Use My Network to grant phone contact access before importing contacts."
      );
      return;
    }

    try {
      const graph = await postJson<NetworkGraphSummary>("/network/sync/contacts", {
        sourceName: "Phone contacts",
        contacts
      });
      setNetworkGraph(graph);
      deps.setStatusMessage("Phone commerce network synced");
    } catch (error) {
      deps.setStatusMessage(getErrorMessage(error));
    }
  }

  async function syncSelectedNetworkPhoneContacts(
    selectedContacts: ContactPickerContact[]
  ): Promise<NetworkGraphSummary | null> {
    const contacts = selectedContacts.map(contactPickerContactToNetworkContact).filter(
      (
        contact
      ): contact is {
        name: string;
        phone: string | null;
        email: string | null;
      } => contact !== null
    );

    if (contacts.length === 0) {
      deps.setStatusMessage("No contacts with a usable name were selected.");
      return null;
    }

    try {
      const graph = await postJson<NetworkGraphSummary>("/network/sync/contacts", {
        sourceName: "Phone Contacts",
        contacts
      });
      setNetworkGraph(graph);
      deps.setStatusMessage(
        `Imported ${contacts.length} contact${contacts.length === 1 ? "" : "s"} into My Network.`
      );
      return graph;
    } catch (error) {
      deps.setStatusMessage(getErrorMessage(error));
      return null;
    }
  }

  async function inviteNetworkContacts(selectedContacts: ContactPickerContact[]): Promise<number> {
    if (deps.business === null) return 0;
    const contacts = selectedContacts
      .map(contactPickerContactToNetworkContact)
      .filter(
        (contact): contact is { name: string; phone: string | null; email: string | null } =>
          contact !== null && (contact.phone !== null || contact.email !== null)
      );
    if (contacts.length === 0) return 0;

    const response = await postJson<NetworkInvitesResponse>(
      `/businesses/${deps.business.id}/network/invites`,
      { contacts }
    );
    await loadNetworkInvites(deps.business.id);
    deps.setStatusMessage(
      `${response.invites.length} invite${response.invites.length === 1 ? "" : "s"} queued for delivery.`
    );
    return response.invites.length;
  }

  async function syncSocialNetwork(
    provider: SocialSignupProvider,
    authenticateSocialProfile: (
      provider: SocialSignupProvider,
      purpose?: "identity" | "contacts"
    ) => Promise<void>
  ) {
    await authenticateSocialProfile(provider, provider === "google" ? "contacts" : "identity");
  }

  // targetNodeId stays the first parameter to match the existing SokoApplication.tsx call site
  // (requesting a route to one specific node); requestText is additive.
  async function requestNetworkRoute(targetNodeId?: string, requestText?: string) {
    try {
      const route = await postJson<AgentRouteSummary>("/network/routes", {
        // Falls back to a generic search only when no chat message drove this call - the server
        // matches requestText against network node names (services/api/src/cp2/domains/network/
        // store.ts), so a specific owner request ("find a supplier for rice") must reach it
        // instead of being silently replaced. See docs/frontend/frontend.md Phase 4g.
        requestText: requestText?.trim() || "Find suppliers through my network",
        ...(targetNodeId === undefined ? {} : { targetNodeId })
      });
      setNetworkGraph((graph) =>
        graph === null
          ? graph
          : {
              ...graph,
              routes: [...graph.routes.filter((item) => item.id !== route.id), route]
            }
      );
      deps.setStatusMessage("Agent route requested");
    } catch (error) {
      deps.setStatusMessage(getErrorMessage(error));
    }
  }

  async function approveNetworkRoute(routeId: string) {
    try {
      const route = await postJson<AgentRouteSummary>(`/network/routes/${routeId}/approve`, {});
      setNetworkGraph((graph) =>
        graph === null
          ? graph
          : {
              ...graph,
              routes: graph.routes.map((item) => (item.id === route.id ? route : item))
            }
      );
      deps.setStatusMessage("Agent route approved");
    } catch (error) {
      deps.setStatusMessage(getErrorMessage(error));
    }
  }

  async function rejectNetworkRoute(routeId: string) {
    try {
      const route = await postJson<AgentRouteSummary>(`/network/routes/${routeId}/reject`, {});
      setNetworkGraph((graph) =>
        graph === null
          ? graph
          : {
              ...graph,
              routes: graph.routes.map((item) => (item.id === route.id ? route : item))
            }
      );
      deps.setStatusMessage("Agent route rejected");
    } catch (error) {
      deps.setStatusMessage(getErrorMessage(error));
    }
  }

  async function disconnectNetworkSource(sourceId: string) {
    try {
      setNetworkGraph(await deleteJson<NetworkGraphSummary>(`/network/sources/${sourceId}`));
      deps.setStatusMessage("Network source disconnected");
    } catch (error) {
      deps.setStatusMessage(getErrorMessage(error));
    }
  }

  async function shareOwnerStorefrontInvite() {
    if (deps.business === null) {
      return;
    }

    const publicStorefrontUrl = createPublicStorefrontUrl(deps.business);
    const shareData = {
      title: `${deps.business.name} on Soko.market`,
      text: `Open ${deps.business.name} with Soko Shop ID ${deps.business.sokoId}.`,
      url: publicStorefrontUrl
    };

    try {
      if (navigator.share !== undefined) {
        await navigator.share(shareData);
      } else {
        await copyTextToClipboard(`${shareData.text} ${publicStorefrontUrl}`);
      }
      deps.setStatusMessage("Storefront invite ready to share");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return;
      }
      deps.setStatusMessage("Invite sharing is not available on this device");
    }
  }

  async function importContactRecords(
    records: Array<Pick<CustomerFormState, "name" | "phone" | "email" | "notes">>
  ) {
    if (deps.business === null || records.length === 0) {
      return;
    }

    try {
      for (const record of records) {
        await postJson<CustomerSummary>(`/businesses/${deps.business.id}/customers`, {
          name: record.name,
          phone: record.phone,
          email: record.email,
          notes: record.notes
        });
      }
      await deps.loadCustomers(deps.business.id);
      deps.setStatusMessage(`Imported ${records.length} contact${records.length === 1 ? "" : "s"}`);
    } catch (error) {
      deps.setStatusMessage(getErrorMessage(error));
    }
  }

  // setChatMessages is a call-time argument, not a hook-level dep: it's owned by the Chat domain
  // hook (Phase 16), which itself needs getCustomers/loadCustomers from this hook - the same
  // two-way dependency class fixed for Sync (Phase 7) and Runtime history (Phase 16) by passing
  // the setter at call time instead of hook-invocation time.
  async function syncOwnerPhoneContacts(setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>) {
    const contactNavigator = navigator as ContactPickerNavigator;

    if (contactNavigator.contacts?.select === undefined) {
      deps.setStatusMessage("Contact sync is available on supported mobile browsers");
      await shareOwnerStorefrontInvite();
      return;
    }

    try {
      const selectedContacts = await contactNavigator.contacts.select(["name", "tel", "email"], {
        multiple: true
      });

      if (selectedContacts.length === 0) {
        return;
      }

      const labels = selectedContacts
        .map((contact) => contact.name?.[0] ?? contact.tel?.[0] ?? contact.email?.[0])
        .filter((label): label is string => label !== undefined && label.trim().length > 0);
      const records = selectedContacts
        .map(contactPickerContactToCustomer)
        .filter(
          (record): record is Pick<CustomerFormState, "name" | "phone" | "email" | "notes"> =>
            record !== null
        );
      await importContactRecords(records);
      setChatMessages((messages) => [
        ...messages,
        {
          id: `sokoclaw-contacts-${Date.now()}`,
          author: "sokoclaw",
          body: `I found ${selectedContacts.length} contact${
            selectedContacts.length === 1 ? "" : "s"
          }: ${labels.slice(0, 5).join(", ") || "selected contacts"}. Use Invite to share your storefront link.`
        }
      ]);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return;
      }
      deps.setStatusMessage(getUserFacingErrorMessage(caught));
    }
  }

  async function importContactsFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (file === undefined) {
      return;
    }

    const content = await file.text();
    await importContactRecords(parseContactImportContent(content));
  }

  function exportOwnerContacts() {
    const customers = deps.getCustomers();
    const csv = createContactsCsv(customers);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${deps.business?.name ?? "soko"}-contacts.csv`;
    link.click();
    URL.revokeObjectURL(url);
    deps.setStatusMessage(
      `Exported ${customers.length} contact${customers.length === 1 ? "" : "s"}`
    );
  }

  deps.registerReset("network", () => {
    setNetworkGraph(null);
    setNetworkInvites([]);
  });
  deps.registerRefresh("network", ["home", "network"], async (businessId) => {
    await Promise.all([loadNetworkGraph(), loadNetworkInvites(businessId)]);
  });

  return {
    networkGraph,
    // Exposed raw: completeOAuthSession (Auth domain, still inline in OwnerApp until Phase 18)
    // writes networkGraph directly after syncing a social provider's network source, mirroring the
    // otpChallengesMap-style escape hatch used elsewhere for a not-yet-extracted caller that needs
    // raw mutation access rather than going through this hook's own action functions.
    setNetworkGraph,
    networkInvites,
    loadNetworkGraph,
    loadNetworkInvites,
    syncPhoneNetwork,
    syncSelectedNetworkPhoneContacts,
    inviteNetworkContacts,
    syncSocialNetwork,
    requestNetworkRoute,
    approveNetworkRoute,
    rejectNetworkRoute,
    disconnectNetworkSource,
    shareOwnerStorefrontInvite,
    importContactRecords,
    syncOwnerPhoneContacts,
    importContactsFile,
    exportOwnerContacts
  };
}
