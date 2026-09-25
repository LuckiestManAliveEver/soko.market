import type { BusinessRole } from "@soko/shared-types";
import { fulfillmentLanguage, type FulfillmentLanguage } from "./fulfillment-copy";

// English and Swahili copy for staff invitations (StaffCard, StaffInvitationsPrompt). Staff often
// run the device in Swahili, so these follow the browser language like the fulfillment cards.

const en = {
  staff: "Staff",
  heading: "People in this business",
  intro:
    "Invite the people who work with you. They sign in to Soko with the phone number you enter and accept the invitation; you can change their role or remove them at any time.",
  role: {
    owner: "Owner",
    manager: "Manager (dispatcher)",
    sales_agent: "Salesperson",
    cashier: "Cashier",
    driver: "Driver",
    view_only: "View only"
  } satisfies Record<BusinessRole, string>,
  roleHelp: {
    owner: "Everything, including settings and staff.",
    manager: "Runs sales, stock and deliveries; can invite staff below manager.",
    sales_agent: "Adds shops, takes orders, captures shop locations.",
    cashier: "Records payments.",
    driver: "Sees delivery work and records deliveries.",
    view_only: "Can look, cannot change anything."
  } satisfies Record<BusinessRole, string>,
  you: "You",
  members: "Members",
  pending: "Waiting for them to accept",
  noPending: "No invitations waiting.",
  invite: "Invite someone",
  name: "Their name",
  phone: "Their phone number",
  roleLabel: "Role",
  send: "Create invitation",
  invited: (name: string, phone: string) =>
    `Invitation ready. Ask ${name} to sign in to Soko with ${phone} and accept it.`,
  shareText: (business: string, role: string) =>
    `You're invited to join ${business} on Soko as ${role}. Sign in to Soko with this phone number to accept.`,
  share: "Share",
  copied: "Copied",
  expires: (date: string) => `expires ${date}`,
  revoke: "Revoke",
  remove: "Remove",
  confirmRemove: (name: string) => `Remove ${name}`,
  confirmRevoke: (name: string) => `Cancel ${name}'s invitation`,
  needsReinvite:
    "This number was added to a Soko account after you invited it, so this invitation can't be accepted. Revoke it and invite again.",
  cancel: "Cancel",
  changeRole: "Change role",
  removed: "Removed",
  saved: "Saved",
  loading: "Loading…",
  retry: "Try again",
  leave: "Leave this business",
  confirmLeave: "Yes, leave",
  // Invitee side
  invitations: "Invitations",
  invitationFrom: (business: string, role: string, by: string) =>
    by.trim() === ""
      ? `${business} invited you to join as ${role}.`
      : `${by} invited you to join ${business} as ${role}.`,
  accept: "Accept",
  decline: "Decline",
  joined: (business: string) => `You joined ${business}.`
};

export type StaffCopy = typeof en;

const sw: StaffCopy = {
  staff: "Wafanyakazi",
  heading: "Watu katika biashara hii",
  intro:
    "Alika watu unaofanya kazi nao. Wanaingia Soko kwa namba ya simu utakayoandika na kukubali mwaliko; unaweza kubadilisha jukumu lao au kuwaondoa wakati wowote.",
  role: {
    owner: "Mmiliki",
    manager: "Meneja (msimamizi wa usafirishaji)",
    sales_agent: "Muuzaji",
    cashier: "Keshia",
    driver: "Dereva",
    view_only: "Kuangalia tu"
  } satisfies Record<BusinessRole, string>,
  roleHelp: {
    owner: "Kila kitu, pamoja na mipangilio na wafanyakazi.",
    manager:
      "Anaendesha mauzo, bidhaa na usafirishaji; anaweza kualika wafanyakazi walio chini ya meneja.",
    sales_agent: "Anaongeza maduka, anachukua oda, anarekodi mahali pa maduka.",
    cashier: "Anarekodi malipo.",
    driver: "Anaona kazi za kupeleka na kurekodi zilizofikishwa.",
    view_only: "Anaweza kuangalia, hawezi kubadilisha chochote."
  } satisfies Record<BusinessRole, string>,
  you: "Wewe",
  members: "Wanachama",
  pending: "Wanasubiriwa kukubali",
  noPending: "Hakuna mialiko inayosubiri.",
  invite: "Alika mtu",
  name: "Jina lake",
  phone: "Namba yake ya simu",
  roleLabel: "Jukumu",
  send: "Tengeneza mwaliko",
  invited: (name: string, phone: string) =>
    `Mwaliko uko tayari. Mwambie ${name} aingie Soko kwa ${phone} na aukubali.`,
  shareText: (business: string, role: string) =>
    `Umealikwa kujiunga na ${business} kwenye Soko kama ${role}. Ingia Soko kwa namba hii ya simu ili kukubali.`,
  share: "Shiriki",
  copied: "Imenakiliwa",
  expires: (date: string) => `unaisha ${date}`,
  revoke: "Futa mwaliko",
  remove: "Ondoa",
  confirmRemove: (name: string) => `Ondoa ${name}`,
  confirmRevoke: (name: string) => `Futa mwaliko wa ${name}`,
  needsReinvite:
    "Namba hii iliongezwa kwenye akaunti ya Soko baada ya kuialika, kwa hiyo mwaliko huu hauwezi kukubaliwa. Ufute kisha ualike tena.",
  cancel: "Ghairi",
  changeRole: "Badilisha jukumu",
  removed: "Ameondolewa",
  saved: "Imehifadhiwa",
  loading: "Inapakia…",
  retry: "Jaribu tena",
  leave: "Ondoka kwenye biashara hii",
  confirmLeave: "Ndiyo, ondoka",
  invitations: "Mialiko",
  invitationFrom: (business: string, role: string, by: string) =>
    by.trim() === ""
      ? `${business} imekualika kujiunga kama ${role}.`
      : `${by} amekualika kujiunga na ${business} kama ${role}.`,
  accept: "Kubali",
  decline: "Kataa",
  joined: (business: string) => `Umejiunga na ${business}.`
};

export function staffCopy(language: FulfillmentLanguage = fulfillmentLanguage()): StaffCopy {
  return language === "sw" ? sw : en;
}
