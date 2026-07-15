import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const requireApproved = process.argv.includes("--require-approved");
const readiness = readJson("config/play-legal-readiness.json");
const mainSource = readText("apps/web/src/main.tsx");
const deletionPage = readText("apps/web/src/legal/AccountDeletionPage.tsx");
const privacyPage = readText("apps/web/src/legal/PrivacyPolicyPage.tsx");
const termsPage = readText("apps/web/src/legal/TermsOfServicePage.tsx");
const renderBlueprint = readText("render.yaml");
const purgeMigration = readText("infra/db/migrations/022_account_deletion_purge.sql");
const purgeScript = readText("services/api/scripts/purge-account-deletions.mjs");
const errors = [];
const pending = [];

check(readiness.schemaVersion === 1, "schemaVersion must be 1");
check(readiness.checkpoint === "CP27", "checkpoint must be CP27");
check(readiness.$schema === "./play-legal-readiness.schema.json", "$schema is invalid");
check(isDate(readiness.lastReviewedOn), "lastReviewedOn must be an ISO calendar date");
check(["proposed", "approved"].includes(readiness.readinessStatus), "readinessStatus is invalid");
check(readiness.product?.appName === "Soko.market", "appName must be Soko.market");
check(
  readiness.legalDocuments?.privacyPolicyUrl === "https://soko.market/privacy",
  "privacy policy URL is invalid"
);
check(readiness.legalDocuments?.termsUrl === "https://soko.market/terms", "terms URL is invalid");
check(
  readiness.accountDeletion?.externalRequestUrl === "https://soko.market/account-deletion",
  "external account-deletion URL is invalid"
);
check(readiness.accountDeletion?.androidAppRequired === false, "Android app must not be required");
check(
  readiness.accountDeletion?.requestPathImplemented === true,
  "external deletion request path must be implemented"
);
check(
  readiness.accountDeletion?.associatedDataIncluded === true,
  "associated data must be included"
);
check(
  readiness.accountDeletion?.lawfulRetentionDisclosed === true,
  "lawful retention must be disclosed"
);
check(
  Number.isInteger(readiness.accountDeletion?.recoveryPeriodDays) &&
    readiness.accountDeletion.recoveryPeriodDays >= 0,
  "recovery period must be a non-negative integer"
);
check(
  mainSource.includes('window.location.pathname === "/account-deletion"'),
  "public route is missing"
);
check(
  mainSource.includes('get("intent") === "account-deletion"'),
  "secure deletion intent is missing"
);
check(deletionPage.includes("Soko.market account"), "deletion resource must name the app");
check(deletionPage.includes("associated"), "deletion resource must explain associated data");
check(deletionPage.includes("up to 30 days"), "deletion resource must explain recovery timing");
check(privacyPage.includes("Privacy Policy"), "privacy policy page is missing");
check(termsPage.includes("Terms of Service"), "Terms of Service page is missing");
check(
  renderBlueprint.includes("source: /*\n        destination: /index.html"),
  "SPA route rewrite is missing"
);
check(renderBlueprint.includes("name: soko-market-account-purge"), "account purge cron is missing");
check(
  renderBlueprint.includes("ACCOUNT_DELETION_PROCESSORS_JSON"),
  "processor configuration secret is missing"
);
check(
  purgeMigration.includes("cp2_account_deletion_proofs"),
  "account deletion proof migration is missing"
);
check(
  purgeScript.includes("purgeExpiredAccountDeletions"),
  "expired account purge runner is missing"
);
check(
  readiness.policyBaseline?.accountDeletionSource ===
    "https://support.google.com/googleplay/android-developer/answer/13327111",
  "account deletion policy source is invalid"
);
check(
  readiness.policyBaseline?.userDataSource ===
    "https://support.google.com/googleplay/android-developer/answer/10144311",
  "user data policy source is invalid"
);
check(
  readiness.policyBaseline?.revalidateBeforeSubmission === true,
  "policy must be revalidated before submission"
);

for (const key of [
  "playDeveloperName",
  "legalEntityName",
  "registeredAddress",
  "countryOfRegistration",
  "registrationNumber"
]) {
  pendingValue(`product.${key}`, hasText(readiness.product?.[key]));
}

for (const key of ["supportEmail", "privacyEmail", "legalEmail"]) {
  pendingValue(`contacts.${key}`, isEmail(readiness.contacts?.[key]));
}

pendingValue(
  "contacts.contactVerificationStatus",
  readiness.contacts?.contactVerificationStatus === "verified"
);
pendingValue(
  "legalDocuments.privacyPolicyStatus",
  readiness.legalDocuments?.privacyPolicyStatus === "approved"
);
pendingValue(
  "legalDocuments.privacyPolicyEffectiveOn",
  isDate(readiness.legalDocuments?.privacyPolicyEffectiveOn)
);
pendingValue("legalDocuments.termsStatus", readiness.legalDocuments?.termsStatus === "approved");
pendingValue("legalDocuments.termsEffectiveOn", isDate(readiness.legalDocuments?.termsEffectiveOn));
pendingValue(
  "legalDocuments.legalApprovalReference",
  hasText(readiness.legalDocuments?.legalApprovalReference)
);
pendingValue(
  "accountDeletion.fulfillmentRunbookStatus",
  readiness.accountDeletion?.fulfillmentRunbookStatus === "verified"
);
pendingValue(
  "accountDeletion.serviceProviderDeletionStatus",
  readiness.accountDeletion?.serviceProviderDeletionStatus === "verified"
);
pendingValue(
  "accountDeletion.operationsOwner",
  hasText(readiness.accountDeletion?.operationsOwner)
);
pendingValue("accountDeletion.privacyOwner", hasText(readiness.accountDeletion?.privacyOwner));
pendingValue("approval.approvedBy", hasText(readiness.approval?.approvedBy));
pendingValue("approval.approvedOn", isDate(readiness.approval?.approvedOn));
pendingValue("approval.changeRecord", hasText(readiness.approval?.changeRecord));

if (readiness.readinessStatus === "approved" && pending.length > 0) {
  errors.push("readinessStatus cannot be approved while required approvals remain pending");
}
if (requireApproved && readiness.readinessStatus !== "approved") {
  errors.push("CP27 legal readiness has not been approved");
}
if (requireApproved && pending.length > 0) {
  errors.push(`CP27 approval fields remain pending: ${pending.join(", ")}`);
}

if (errors.length > 0) {
  console.error("Google Play legal readiness verification failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Google Play legal readiness is structurally valid (${readiness.readinessStatus}).`);
if (pending.length > 0) console.log(`Pending CP27 approvals: ${pending.join(", ")}`);

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function readText(relativePath) {
  return readFileSync(join(workspaceRoot, relativePath), "utf8");
}

function check(condition, message) {
  if (!condition) errors.push(message);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function pendingValue(label, satisfied) {
  if (!satisfied) pending.push(label);
}
