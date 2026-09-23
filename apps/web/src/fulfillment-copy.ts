import type {
  CorridorPoolReadiness,
  ManifestStatus,
  ManifestStopDeliveryStatus
} from "@soko/shared-types";

// English and Swahili copy for the corridor-fulfillment cards (field sales and operations). Field
// staff often run the device in Swahili, so these cards follow the browser language instead of
// hard-coding English like the older record cards.
export type FulfillmentLanguage = "en" | "sw";

export function fulfillmentLanguage(): FulfillmentLanguage {
  const language =
    typeof navigator === "undefined" ? "en" : (navigator.language ?? "en").toLowerCase();
  return language.startsWith("sw") ? "sw" : "en";
}

const en = {
  shopLocation: "Shop location",
  captureHeading: "Delivery point",
  noLocation: "No GPS location captured yet.",
  locationCaptured: "Location captured",
  accuracy: (meters: number) => `accurate to about ${Math.round(meters)} m`,
  capture: "Capture current GPS",
  recapture: "Update GPS",
  capturing: "Getting location…",
  geolocationUnavailable: "This device cannot share its location.",
  geolocationDenied: "Location permission was refused. Allow it and try again.",
  corridor: "Corridor",
  onCorridor: (name: string, meters: number) => `${name} · ${Math.round(meters)} m off route`,
  noCorridor: "Not on any corridor yet",
  savedLocation: "Shop location saved",
  dispatch: "Corridor dispatch",
  poolsHeading: "Delivery pools",
  loading: "Loading…",
  noPools: "No corridors yet.",
  orders: (count: number) => (count === 1 ? "1 order" : `${count} orders`),
  ofTarget: (target: string) => `of ${target}`,
  noPolicy: "No dispatch policy",
  readiness: {
    ACCUMULATING: "Filling",
    DISPATCHABLE: "Can dispatch",
    DISPATCH_READY: "Ready to dispatch"
  } satisfies Record<CorridorPoolReadiness, string>,
  staleCount: (count: number) => `${count} need re-checking after a map change`,
  unknownWeightCount: (count: number) => `${count} with unknown weight`,
  cutoffIn: (text: string) => `Cutoff in ${text}`,
  oldestWaiting: (text: string) => `Oldest waiting ${text}`,
  unassigned: "Not on a corridor",
  unassignedDetail: (location: number, corridor: number, pending: number, orphaned: number) =>
    `${location} without GPS · ${corridor} off every corridor · ${pending} waiting intake · ${orphaned} orphaned`,
  createManifest: "Create manifest",
  vehicle: "Vehicle",
  chooseVehicle: "Choose a vehicle",
  noVehicles: "Add a vehicle before creating a manifest.",
  created: (count: number, skipped: number, planning: number) =>
    `Manifest created with ${count} orders` +
    (skipped > 0 ? ` · ${skipped} did not fit and stay pooled` : "") +
    (planning > 0 ? ` · ${planning} too heavy for this vehicle` : ""),
  manifests: "Manifests",
  noManifests: "No manifests yet.",
  manifestStatus: {
    DRAFT: "Draft",
    OPEN: "Open",
    CLOSED: "Closed",
    DEPARTED: "Departed",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled"
  } satisfies Record<ManifestStatus, string>,
  stopStatus: {
    PENDING: "Pending",
    ARRIVED: "Arrived",
    DELIVERED: "Delivered",
    FAILED: "Failed",
    SKIPPED: "Skipped"
  } satisfies Record<ManifestStopDeliveryStatus, string>,
  loadOf: (load: string, capacity: string) => `${load} of ${capacity}`,
  close: "Close manifest",
  remove: "Remove",
  arrived: "Arrived",
  delivered: "Delivered",
  failed: "Failed",
  skipped: "Skipped",
  note: "Reason",
  noteRequired: "Enter a reason for a failed or skipped delivery.",
  released: "Returned to pool",
  walkIn: "Walk-in customer"
};

export type FulfillmentCopy = typeof en;

const sw: FulfillmentCopy = {
  shopLocation: "Mahali pa duka",
  captureHeading: "Mahali pa kupeleka",
  noLocation: "Bado hakuna eneo la GPS.",
  locationCaptured: "Eneo limehifadhiwa",
  accuracy: (meters: number) => `usahihi wa takriban mita ${Math.round(meters)}`,
  capture: "Chukua GPS ya sasa",
  recapture: "Sasisha GPS",
  capturing: "Inatafuta eneo…",
  geolocationUnavailable: "Kifaa hiki hakiwezi kutoa eneo lake.",
  geolocationDenied: "Ruhusa ya eneo imekataliwa. Iruhusu kisha ujaribu tena.",
  corridor: "Njia",
  onCorridor: (name: string, meters: number) => `${name} · mita ${Math.round(meters)} kutoka njia`,
  noCorridor: "Bado haiko kwenye njia yoyote",
  savedLocation: "Mahali pa duka pamehifadhiwa",
  dispatch: "Usafirishaji kwa njia",
  poolsHeading: "Mizigo inayosubiri",
  loading: "Inapakia…",
  noPools: "Bado hakuna njia.",
  orders: (count: number) => (count === 1 ? "oda 1" : `oda ${count}`),
  ofTarget: (target: string) => `kati ya ${target}`,
  noPolicy: "Hakuna sera ya usafirishaji",
  readiness: {
    ACCUMULATING: "Inajaa",
    DISPATCHABLE: "Inaweza kutumwa",
    DISPATCH_READY: "Tayari kutumwa"
  } satisfies Record<CorridorPoolReadiness, string>,
  staleCount: (count: number) => `${count} zinahitaji kukaguliwa upya baada ya ramani kubadilika`,
  unknownWeightCount: (count: number) => `${count} hazina uzito unaojulikana`,
  cutoffIn: (text: string) => `Muda wa mwisho baada ya ${text}`,
  oldestWaiting: (text: string) => `Ya zamani zaidi imesubiri ${text}`,
  unassigned: "Haziko kwenye njia",
  unassignedDetail: (location: number, corridor: number, pending: number, orphaned: number) =>
    `${location} bila GPS · ${corridor} nje ya njia zote · ${pending} zinasubiri kupokelewa · ${orphaned} zimepotea`,
  createManifest: "Unda orodha ya safari",
  vehicle: "Gari",
  chooseVehicle: "Chagua gari",
  noVehicles: "Ongeza gari kabla ya kuunda orodha ya safari.",
  created: (count: number, skipped: number, planning: number) =>
    `Orodha imeundwa na oda ${count}` +
    (skipped > 0 ? ` · ${skipped} hazikutosha na zimebaki zikisubiri` : "") +
    (planning > 0 ? ` · ${planning} ni nzito mno kwa gari hili` : ""),
  manifests: "Orodha za safari",
  noManifests: "Bado hakuna orodha za safari.",
  manifestStatus: {
    DRAFT: "Rasimu",
    OPEN: "Wazi",
    CLOSED: "Imefungwa",
    DEPARTED: "Imeondoka",
    COMPLETED: "Imekamilika",
    CANCELLED: "Imeghairiwa"
  } satisfies Record<ManifestStatus, string>,
  stopStatus: {
    PENDING: "Inasubiri",
    ARRIVED: "Imefika",
    DELIVERED: "Imefikishwa",
    FAILED: "Imeshindikana",
    SKIPPED: "Imerukwa"
  } satisfies Record<ManifestStopDeliveryStatus, string>,
  loadOf: (load: string, capacity: string) => `${load} kati ya ${capacity}`,
  close: "Funga orodha",
  remove: "Ondoa",
  arrived: "Imefika",
  delivered: "Imefikishwa",
  failed: "Imeshindikana",
  skipped: "Imerukwa",
  note: "Sababu",
  noteRequired: "Andika sababu ya kushindikana au kurukwa.",
  released: "Imerudishwa kusubiri",
  walkIn: "Mteja wa papo hapo"
};

export function fulfillmentCopy(
  language: FulfillmentLanguage = fulfillmentLanguage()
): FulfillmentCopy {
  return language === "sw" ? sw : en;
}

/** A coarse, language-neutral duration ("2d 4h", "35m") for countdowns and ages. */
export function formatDurationSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
