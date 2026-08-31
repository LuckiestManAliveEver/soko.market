import { useEffect, useState } from "react";

import { AuthenticationActionMessage } from "./AuthenticationActionMessage";

import {
  type ContactPickerContact,
  type ContactPickerNavigator,
  type NetworkGraphSummary,
  type NetworkSyncProviderId,
  type NetworkSyncSourceSummary,
  type OAuthProviderSummary,
  type SocialSignupProvider,
  networkSyncProviders
} from "./soko-application-shared";

import { getErrorMessage } from "./chat-message-plumbing";

export function NetworkSyncNestedCard({
  graph,
  oauthProviders,
  oauthProvidersLoaded,
  onBack,
  onDisconnectSource,
  onOAuthProvider,
  onPhoneContactsSync,
  onInviteContacts,
  onRefresh
}: {
  graph: NetworkGraphSummary | null;
  oauthProviders: OAuthProviderSummary[];
  oauthProvidersLoaded: boolean;
  onBack: () => void;
  onDisconnectSource: (sourceId: string) => void;
  onOAuthProvider: (
    provider: SocialSignupProvider,
    purpose?: "identity" | "contacts"
  ) => Promise<void>;
  onPhoneContactsSync: (
    selectedContacts: ContactPickerContact[]
  ) => Promise<NetworkGraphSummary | null>;
  onInviteContacts: (selectedContacts: ContactPickerContact[]) => Promise<number>;
  onRefresh: () => void;
}) {
  const [view, setView] = useState<"providers" | "phone">("providers");
  const [localGraph, setLocalGraph] = useState<NetworkGraphSummary | null>(graph);
  const [selectedContacts, setSelectedContacts] = useState<ContactPickerContact[]>([]);
  const [selectedContactKeys, setSelectedContactKeys] = useState<string[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setLocalGraph(graph);
  }, [graph]);

  const activeGraph = localGraph ?? graph;
  const phoneSource = getActiveNetworkSource(activeGraph, "phone");
  const visibleNetworkSyncProviders = networkSyncProviders.filter(
    (provider) =>
      provider.id === "phone" ||
      oauthProviders.some(
        (oauthProvider) =>
          oauthProvider.id === provider.oauthProvider &&
          oauthProvider.configured &&
          oauthProvider.enabled !== false &&
          oauthProvider.implemented !== false
      )
  );
  const alreadyOnSokoCount =
    activeGraph?.nodes?.filter(
      (node) =>
        node.sourceType === "phone_contact" &&
        node.degree === 1 &&
        (node.kind === "soko_user" || node.sokoUserId != null)
    ).length ?? 0;
  const filteredContacts = selectedContacts.filter((contact) =>
    getContactDisplayName(contact).toLowerCase().includes(contactSearch.trim().toLowerCase())
  );
  const inviteContacts = filteredContacts.filter((contact) => {
    const converted = contactPickerContactToNetworkContact(contact);
    return converted !== null && (converted.phone !== null || converted.email !== null);
  });
  const unknownContacts = filteredContacts.filter((contact) => {
    const converted = contactPickerContactToNetworkContact(contact);
    return converted === null || (converted.phone === null && converted.email === null);
  });

  async function requestPhoneContacts() {
    const contactNavigator = navigator as ContactPickerNavigator;

    if (contactNavigator.contacts?.select === undefined) {
      setMessage("Contact permission is only available on supported Android mobile browsers.");
      return;
    }

    try {
      const contacts = await contactNavigator.contacts.select(["name", "tel", "email"], {
        multiple: true
      });

      if (contacts.length === 0) {
        setMessage("No contacts selected.");
        return;
      }

      const nextGraph = await onPhoneContactsSync(contacts);
      setSelectedContacts(contacts);
      setSelectedContactKeys(contacts.map(contactSelectionKey));
      if (nextGraph !== null) {
        setLocalGraph(nextGraph);
      }
      setMessage(
        `Imported ${contacts.length} selected contact${contacts.length === 1 ? "" : "s"}.`
      );
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return;
      }
      setMessage("Contact access was denied. You can allow it later from your browser settings.");
    }
  }

  async function connectProvider(providerId: NetworkSyncProviderId) {
    const provider = networkSyncProviders.find((item) => item.id === providerId);

    if (provider?.id === "phone") {
      setView("phone");
      return;
    }

    if (provider?.oauthProvider === null || provider === undefined) {
      setMessage("This login provider is not configured yet.");
      return;
    }

    const oauthConfig = oauthProviders.find((item) => item.id === provider.oauthProvider);

    if (!oauthProvidersLoaded) {
      setMessage("Social providers are still loading. Try again in a moment.");
      return;
    }

    if (oauthConfig?.implemented === false || oauthConfig?.configured !== true) {
      setMessage("This login provider is not configured yet.");
      return;
    }

    await onOAuthProvider(
      provider.oauthProvider,
      provider.oauthProvider === "google" ? "contacts" : "identity"
    );
  }

  function selectAllVisibleContacts() {
    setSelectedContactKeys(filteredContacts.map(contactSelectionKey));
  }

  async function inviteSelectedContacts() {
    if (selectedContactKeys.length === 0) {
      setMessage("Select contacts to invite first.");
      return;
    }

    const contacts = selectedContacts.filter((contact) =>
      selectedContactKeys.includes(contactSelectionKey(contact))
    );
    try {
      const count = await onInviteContacts(contacts);
      setMessage(
        count === 0
          ? "No selected contact had a usable phone number or email."
          : `${count} invite${count === 1 ? "" : "s"} queued for delivery.`
      );
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  }

  function disconnectPhoneSource() {
    if (phoneSource === null) {
      setMessage("Phone contacts are not connected yet.");
      return;
    }

    onDisconnectSource(phoneSource.id);
    setLocalGraph((current) =>
      current === null
        ? current
        : {
            ...current,
            sources: current.sources.map((source) =>
              source.id === phoneSource.id
                ? { ...source, status: "disconnected", importedCount: 0 }
                : source
            )
          }
    );
    setMessage("Phone contact access was revoked for this workspace.");
  }

  if (view === "phone") {
    return (
      <section className="nested-card network-sync-card" aria-label="Phone Contacts">
        <button className="nested-breadcrumb" type="button" onClick={() => setView("providers")}>
          &lt; My Network
        </button>
        <div className="nested-card-title-row">
          <div>
            <h3>Phone Contacts</h3>
            <p>Allow Soko to access contacts only when you tap Allow Access.</p>
          </div>
          <span className={phoneSource === null ? "network-status disconnected" : "network-status"}>
            {phoneSource === null ? "Not Connected" : "Connected"}
          </span>
        </div>
        <div className="permission-checklist">
          <span>Read contacts</span>
          <span>Detect existing Soko users</span>
          <span>Invite non-users</span>
          <span>Keep contacts synchronized</span>
        </div>
        <div className="nested-form-actions">
          <button type="button" onClick={() => void requestPhoneContacts()}>
            Allow Access
          </button>
          <button className="secondary" type="button" onClick={() => void requestPhoneContacts()}>
            Refresh
          </button>
          <button className="secondary" type="button" onClick={disconnectPhoneSource}>
            Disconnect
          </button>
        </div>
        {selectedContacts.length > 0 ? (
          <div className="phone-contact-manager">
            <label className="network-search">
              <span>Search</span>
              <input
                value={contactSearch}
                onChange={(event) => setContactSearch(event.target.value)}
                placeholder="Search imported contacts"
              />
            </label>
            <div className="nested-form-actions">
              <button className="secondary" type="button" onClick={selectAllVisibleContacts}>
                Select All
              </button>
              <button type="button" onClick={() => void inviteSelectedContacts()}>
                Invite Selected
              </button>
            </div>
            <NetworkContactGroup
              contacts={[]}
              count={alreadyOnSokoCount}
              title="Already using Soko"
            />
            <NetworkContactGroup
              contacts={inviteContacts}
              selectedContactKeys={selectedContactKeys}
              title="Invite to Soko"
              onToggle={(key) =>
                setSelectedContactKeys((keys) =>
                  keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key]
                )
              }
            />
            <NetworkContactGroup contacts={unknownContacts} title="Unknown contacts" />
          </div>
        ) : null}
        {message.length > 0 ? (
          <p className="setup-status">
            <AuthenticationActionMessage message={message} />
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="nested-card network-sync-card" aria-label="My Network providers">
      <button className="nested-breadcrumb" type="button" onClick={onBack}>
        &lt; Workspace
      </button>
      <div className="nested-card-title-row">
        <div>
          <h3>My Network</h3>
          <p>Connect relationship sources for your shop agent.</p>
        </div>
        <button className="small-outline-button" type="button" onClick={onRefresh}>
          Refresh
        </button>
      </div>
      <div className="network-provider-list">
        {visibleNetworkSyncProviders.map((provider) => {
          const source = getActiveNetworkSource(activeGraph, provider.id);
          const oauthConfig =
            provider.oauthProvider === null
              ? null
              : oauthProviders.find((item) => item.id === provider.oauthProvider);
          const configured =
            provider.id === "phone" ||
            (oauthProvidersLoaded && oauthConfig?.implemented !== false && oauthConfig?.configured);
          const statusText =
            source === null ? (configured ? "Connect" : "Not configured") : "Connected";

          return (
            <article className="network-provider-row" key={provider.id}>
              <button type="button" onClick={() => void connectProvider(provider.id)}>
                <span className="network-provider-icon">{provider.icon}</span>
                <span>
                  <strong>{provider.label}</strong>
                  <small>{provider.detail}</small>
                  <small>
                    {source === null
                      ? "Last sync: never"
                      : `Last sync: ${new Date(source.updatedAt ?? source.createdAt ?? Date.now()).toLocaleString()}`}
                  </small>
                </span>
              </button>
              <div>
                <span
                  className={source === null ? "network-status disconnected" : "network-status"}
                >
                  {statusText}
                </span>
                <strong>{source?.importedCount ?? 0}</strong>
                <small>contacts</small>
              </div>
              <button
                className="secondary"
                type="button"
                onClick={() =>
                  source === null
                    ? void connectProvider(provider.id)
                    : onDisconnectSource(source.id)
                }
              >
                {source === null ? "Sync" : "Disconnect"}
              </button>
            </article>
          );
        })}
      </div>
      {message.length > 0 ? (
        <p className="setup-status">
          <AuthenticationActionMessage message={message} />
        </p>
      ) : null}
    </section>
  );
}

export function NetworkContactGroup({
  contacts,
  count,
  selectedContactKeys,
  title,
  onToggle
}: {
  contacts: ContactPickerContact[];
  count?: number;
  selectedContactKeys?: string[];
  title: string;
  onToggle?: (key: string) => void;
}) {
  return (
    <section className="network-contact-group">
      <h4>
        {title} ({count ?? contacts.length})
      </h4>
      {contacts.length === 0 ? (
        <p className="shell-note">No contacts in this group yet.</p>
      ) : (
        contacts.slice(0, 30).map((contact) => {
          const key = contactSelectionKey(contact);
          const converted = contactPickerContactToNetworkContact(contact);

          return (
            <label key={key}>
              {onToggle !== undefined ? (
                <input
                  checked={selectedContactKeys?.includes(key) ?? false}
                  type="checkbox"
                  onChange={() => onToggle(key)}
                />
              ) : null}
              <span>
                <strong>{getContactDisplayName(contact)}</strong>
                <small>{converted?.phone ?? converted?.email ?? "No phone or email"}</small>
              </span>
            </label>
          );
        })
      )}
    </section>
  );
}

export function getActiveNetworkSource(
  graph: NetworkGraphSummary | null,
  providerId: NetworkSyncProviderId
): NetworkSyncSourceSummary | null {
  if (graph === null) {
    return null;
  }

  const platform = providerId === "phone" ? "phone" : providerId;
  return (
    graph.sources?.find(
      (source) => source.sourcePlatform === platform && source.status === "active"
    ) ?? null
  );
}

export function contactSelectionKey(contact: ContactPickerContact): string {
  return `${getContactDisplayName(contact)}:${contact.tel?.[0] ?? ""}:${contact.email?.[0] ?? ""}`;
}

export function contactPickerContactToNetworkContact(contact: ContactPickerContact): {
  name: string;
  phone: string | null;
  email: string | null;
} | null {
  const name = contact.name?.[0]?.trim() ?? contact.tel?.[0]?.trim() ?? contact.email?.[0]?.trim();

  if (name === undefined || name.length === 0) {
    return null;
  }

  return {
    name,
    phone: contact.tel?.[0]?.trim() || null,
    email: contact.email?.[0]?.trim() || null
  };
}

export function getContactDisplayName(contact: ContactPickerContact): string {
  return (
    contact.name?.[0]?.trim() ??
    contact.tel?.[0]?.trim() ??
    contact.email?.[0]?.trim() ??
    "Unnamed contact"
  );
}
