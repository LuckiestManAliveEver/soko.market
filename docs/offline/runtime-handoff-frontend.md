# Runtime handoff in business settings

See [the canonical runtime handoff contract](../runtime/runtime-handoff.md) for architecture,
capabilities, host integration, lifecycle, deadlines, security, synchronization and recovery.

The settings header shows the canonical Hosted/Local state, Go offline or Go hosted, runtime refresh,
Edit and Sign out. Local availability comes from the runtime API and the connected executable
adapter; the business-data offline build flag is not a runtime capability. Unavailable handoff is
disabled with a specific explanation. Saved prepared operations offer Resume handoff after refresh.

The controller prepares and restores the exact target checkpoint before asking the backend to
commit. The existing account/shop/device local database stores the operation key/ID, portable
checkpoint and separate conversation messages. Chat turns continue through LocalProvider and the
registered LocalHandoffHost. Return synchronizes existing business operations, conversation events
and causal checkpoints before hosted readiness verification. Source data is retained on failure.

This checkout does not include a compatible executable LocalHandoffHost or its installer.
Installing model weights or a business snapshot alone must not enable handoff. Host implementations
must enforce agent/tool/context permissions and register only after provisioning in the native
runtime graph. Test adapters verify the contract; they do not certify a production local executor.
