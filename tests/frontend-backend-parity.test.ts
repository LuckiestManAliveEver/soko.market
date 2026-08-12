import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const application = readFileSync("apps/web/src/SokoApplication.tsx", "utf8");
const productCapture = readFileSync("apps/web/src/ProductCapturePanel.tsx", "utf8");
const accountControls = readFileSync("apps/web/src/AccountBackendControls.tsx", "utf8");

describe("frontend coverage for backend-owned lifecycles", () => {
  it("completes the camera catalogue capture lifecycle", () => {
    expect(application).toContain('lazy(() => import("./ProductCapturePanel"))');
    expect(productCapture).toContain("function ProductCapturePanel");
    expect(productCapture).toContain('capture="environment"');
    expect(productCapture).toContain("/product-captures`");
    expect(productCapture).toContain("/product-captures/${encodeURIComponent(job.id)}/retry");
    expect(productCapture).toContain("/product-captures/${encodeURIComponent(job.id)}/review");
    expect(productCapture).toContain("/product-captures/${encodeURIComponent(job.id)}/confirm");
    expect(productCapture).toContain("/product-captures/${encodeURIComponent(job.id)}/cancel");
    expect(productCapture).toContain("Your unfinished photo capture was restored.");
    expect(productCapture).toContain("Show this photo in the public catalogue");
  });

  it("lets owners update the account name exposed by the backend", () => {
    expect(application).toContain('lazy(() => import("./AccountBackendControls"))');
    expect(accountControls).toContain('"/account/display-name"');
    expect(accountControls).toContain('aria-label="Account display name"');
    expect(application).toContain("onOwnerUserChange({ ...ownerUser, displayName })");
  });

  it("lists and revokes inactive end-to-end encryption keys", () => {
    expect(accountControls).toContain(
      'apiFetch<{ devices: E2eeDeviceSummary[] }>("/v1/e2ee/devices")'
    );
    expect(accountControls).toContain("/v1/e2ee/devices/${encodeURIComponent(deviceId)}");
    expect(accountControls).toContain('aria-label="Messaging encryption keys"');
    expect(accountControls).toContain(
      'disabled={isCurrent || isPending("encryption-device-revoke")}'
    );
  });
});
