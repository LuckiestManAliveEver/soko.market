import { Cp2Error } from "./cp2-error.js";
import type { SocialProfileNetworkInput } from "./domains/network/shared.js";

const googleConnectionsUrl = "https://people.googleapis.com/v1/people/me/connections";
const googleContactsScope = "https://www.googleapis.com/auth/contacts.readonly";

interface GooglePersonField {
  value?: string;
}

interface GooglePerson {
  resourceName?: string;
  names?: Array<{ displayName?: string }>;
  emailAddresses?: GooglePersonField[];
  phoneNumbers?: GooglePersonField[];
}

interface GoogleConnectionsResponse {
  connections?: GooglePerson[];
  nextPageToken?: string;
}

export { googleContactsScope };

export async function fetchGoogleContacts(input: {
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<SocialProfileNetworkInput[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const profiles: SocialProfileNetworkInput[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(googleConnectionsUrl);
    url.searchParams.set("personFields", "names,emailAddresses,phoneNumbers");
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("sources", "READ_SOURCE_TYPE_CONTACT");
    if (pageToken !== undefined) url.searchParams.set("pageToken", pageToken);

    const response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${input.accessToken}`
      }
    });

    if (!response.ok) {
      throw new Cp2Error(
        response.status === 401 || response.status === 403 ? 409 : 502,
        "google_contacts_sync_failed",
        response.status === 401 || response.status === 403
          ? "Google Contacts permission expired. Reconnect Google Contacts to continue."
          : "Google Contacts could not be synchronized right now."
      );
    }

    const payload = (await response.json()) as GoogleConnectionsResponse;
    for (const person of payload.connections ?? []) {
      const email =
        person.emailAddresses?.find((item) => item.value?.trim())?.value?.trim() ?? null;
      const phone = person.phoneNumbers?.find((item) => item.value?.trim())?.value?.trim() ?? null;
      const name = person.names?.find((item) => item.displayName?.trim())?.displayName?.trim();
      const displayName = name ?? email ?? phone;
      if (displayName === undefined || displayName === null) continue;

      profiles.push({
        name: displayName,
        phone,
        email,
        providerSubject: person.resourceName?.trim() || email || phone || displayName,
        relationship: "interaction"
      });
    }

    pageToken = payload.nextPageToken?.trim() || undefined;
  } while (pageToken !== undefined && profiles.length < 5000);

  return profiles.slice(0, 5000);
}
