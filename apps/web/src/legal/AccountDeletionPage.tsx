import { Surface } from "@soko/ui";

export default function AccountDeletionPage() {
  return (
    <Surface title="Delete your Soko.market account">
      <a className="legal-skip-link" href="#account-deletion-content">
        Skip to account deletion
      </a>
      <main className="legal-document-shell account-deletion-shell">
        <header className="legal-document-header">
          <a className="legal-brand" href="/" aria-label="Back to Soko.market home">
            soko.market
          </a>
          <p className="eyebrow">Privacy control</p>
          <h1>Delete your Soko.market account</h1>
          <p className="legal-intro">
            Use this public web resource to request deletion of your Soko.market account and the
            data associated with it, even if the Android app is no longer installed.
          </p>
        </header>

        <section
          id="account-deletion-content"
          className="account-deletion-action-card"
          aria-labelledby="request-deletion-title"
          tabIndex={-1}
        >
          <h2 id="request-deletion-title">Request account deletion</h2>
          <p>
            Sign in on the secure Soko.market website using the phone number or email associated
            with your account. You will be taken directly to the deletion controls.
          </p>
          <a className="account-deletion-primary-action" href="/?intent=account-deletion">
            Continue to secure deletion request
          </a>
          <p className="account-deletion-assurance">
            You do not need to reinstall or open the Android app.
          </p>
        </section>

        <div className="account-deletion-content-grid">
          <section className="legal-section" aria-labelledby="deletion-steps-title">
            <h2 id="deletion-steps-title">What you will do</h2>
            <ol>
              <li>Authenticate with the account you want deleted.</li>
              <li>Review the deletion and retention explanation under Compliance.</li>
              <li>Type DELETE and submit the request.</li>
              <li>Keep the deletion reference shown after submission.</li>
            </ol>
          </section>

          <section className="legal-section" aria-labelledby="deletion-scope-title">
            <h2 id="deletion-scope-title">What the request covers</h2>
            <p>
              The request covers the Soko.market account and associated personal and shop data,
              including profile and authentication links, business records, conversations, uploaded
              content, and device or usage data associated with that account.
            </p>
            <p>
              Associated data held by service providers must also be deleted unless it is subject to
              a lawful retention exception. This propagation is an operational release gate and must
              be verified before Soko.market is submitted to Google Play.
            </p>
          </section>

          <section className="legal-section" aria-labelledby="deletion-timing-title">
            <h2 id="deletion-timing-title">Timing and retention</h2>
            <p>
              Account access is disabled when the request is accepted. Recoverable account data may
              be held for up to 30 days to support accidental-deletion recovery. After that period,
              data scheduled for deletion is permanently deleted or irreversibly anonymized.
            </p>
            <p>
              Limited records may be retained when required for legal compliance, security, fraud
              prevention, dispute handling, financial recordkeeping, or another lawful purpose.
              Retained data is restricted to that purpose and the applicable retention period.
            </p>
          </section>

          <section className="legal-section" aria-labelledby="deletion-help-title">
            <h2 id="deletion-help-title">Before you delete</h2>
            <p>
              Export any records you need before submitting the request. Account deletion is not the
              same as signing out, uninstalling the app, or temporarily hiding a shop.
            </p>
            <p>
              Read the <a href="/privacy#privacy-section-21">Privacy Policy retention section</a>{" "}
              and <a href="/terms#section-59">Terms account-deletion section</a> for the currently
              published details. Both documents remain drafts until the production legal identity
              and effective dates are approved.
            </p>
          </section>
        </div>

        <footer className="legal-document-footer">
          <h2>Soko.market account deletion resource</h2>
          <p>Public URL: https://soko.market/account-deletion</p>
          <p>Last reviewed: July 15, 2026</p>
        </footer>
      </main>
    </Surface>
  );
}
