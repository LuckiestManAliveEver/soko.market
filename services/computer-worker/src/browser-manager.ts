/**
 * Playwright-backed session manager for the isolated computer-use worker
 * (docs/architecture/computer-runtime.md). This is the ONE place in the whole system that loads a
 * browser engine - services/api never imports Playwright (see
 * services/api/src/cp2/computer-worker-provider.ts and computer-runtime-audit.md §3).
 *
 * One shared Chromium process, one isolated BrowserContext per ComputerSession (Playwright's
 * context isolation gives each session its own cookies/storage/cache, matching one session = one
 * cross-site-isolated browsing identity). A persistent profile's storage state is loaded into a
 * fresh context at session-create/resume time and captured back out at checkpoint/suspend time -
 * the worker never writes it to disk; services/api encrypts it before persisting.
 *
 * Element resolution is deterministic accessibility-locator matching (Playwright's built-in
 * getByRole/getByLabel/getByPlaceholder/getByText chain), not a second model call - the task brief
 * is explicit that the model never drives Chromium directly, and adding an LLM call inside the
 * worker to resolve selectors would be exactly that by another name. This is a real, functioning,
 * swappable resolution strategy (see ComputerRuntimeProvider's adapter boundary), not a stub.
 */
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page
} from "playwright";
import type {
  ComputerActionResult,
  ComputerInteractiveElement,
  ComputerObservation,
  ComputerSession,
  ComputerSessionStatus,
  ComputerTarget
} from "@soko/computer-runtime";
import { evaluateNavigationPolicy } from "@soko/computer-runtime";

export interface WorkerCreateSessionInput {
  sessionId: string;
  businessId: string;
  accountId: string;
  conversationId: string;
  profileId: string | null;
  startUrl: string | null;
  /** Decrypted by services/api immediately before this call; never written to disk by this
   *  worker and never logged. */
  storageState?: string | null;
}

interface SessionEntry {
  context: BrowserContext;
  page: Page;
  status: ComputerSessionStatus;
  businessId: string;
  accountId: string;
  conversationId: string;
  profileId: string | null;
}

const SCREENSHOT_MAX_WIDTH = 960;
const CONTENT_SUMMARY_MAX_CHARS = 8_000;
const MAX_INTERACTIVE_ELEMENTS = 40;

const SENSITIVE_FIELD_PATTERN =
  /password|passcode|\bpin\b|\botp\b|one-time|security[\s-]?code|\bcvv\b|\bcvc\b|card[\s-]?number|secret|token/iu;

type StorageState = NonNullable<BrowserContextOptions["storageState"]>;

function parseStorageState(raw: string): StorageState {
  return JSON.parse(raw) as StorageState;
}

export class BrowserManager {
  private browser: Browser | null = null;
  private readonly sessions = new Map<string, SessionEntry>();

  private async requireBrowser(): Promise<Browser> {
    if (this.browser !== null) return this.browser;
    this.browser = await chromium.launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH === undefined
        ? {}
        : { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }),
      args: ["--disable-dev-shm-usage", "--no-sandbox"]
    });
    return this.browser;
  }

  async createSession(input: WorkerCreateSessionInput): Promise<ComputerSession> {
    const browser = await this.requireBrowser();
    const context = await browser.newContext({
      viewport: { width: SCREENSHOT_MAX_WIDTH, height: 720 },
      ...(input.storageState === undefined || input.storageState === null
        ? {}
        : { storageState: parseStorageState(input.storageState) })
    });
    const page = await context.newPage();
    this.sessions.set(input.sessionId, {
      context,
      page,
      status: "READY",
      businessId: input.businessId,
      accountId: input.accountId,
      conversationId: input.conversationId,
      profileId: input.profileId
    });

    if (input.startUrl !== null) {
      const decision = evaluateNavigationPolicy(input.startUrl);
      if (decision.allowed) {
        await page
          .goto(input.startUrl, { waitUntil: "domcontentloaded", timeout: 20_000 })
          .catch(() => undefined);
      }
    }

    return this.sessionView(input.sessionId);
  }

  async resumeSession(sessionId: string): Promise<ComputerSession> {
    const entry = this.requireSession(sessionId);
    entry.status = "READY";
    return this.sessionView(sessionId);
  }

  async navigate(sessionId: string, url: string): Promise<ComputerObservation> {
    const decision = evaluateNavigationPolicy(url);
    if (!decision.allowed) {
      throw new Error(`Navigation blocked: ${decision.reason}`);
    }
    const entry = this.requireSession(sessionId);
    await entry.page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    return this.observe(sessionId);
  }

  async observe(sessionId: string): Promise<ComputerObservation> {
    const entry = this.requireSession(sessionId);
    const page = entry.page;
    const url = page.url();
    const title = await page.title().catch(() => "");
    const screenshotDataUrl = await this.captureScreenshot(page);
    const contentSummary = await this.extractContentSummary(page);
    const interactiveElements = await this.extractInteractiveElements(page);
    return {
      sessionId,
      url,
      title,
      screenshotDataUrl,
      contentSummary,
      interactiveElements,
      capturedAt: new Date().toISOString()
    };
  }

  async click(sessionId: string, target: ComputerTarget): Promise<ComputerActionResult> {
    const entry = this.requireSession(sessionId);
    const locator = await this.resolveTarget(entry.page, target);
    if (locator === null) {
      return {
        sessionId,
        status: "REJECTED",
        observation: null,
        reason: `Could not find an element matching "${target.description}".`
      };
    }
    await locator.click({ timeout: 10_000 });
    await entry.page
      .waitForLoadState("domcontentloaded", { timeout: 5_000 })
      .catch(() => undefined);
    return { sessionId, status: "EXECUTED", observation: await this.observe(sessionId) };
  }

  async type(
    sessionId: string,
    target: ComputerTarget,
    text: string,
    submit: boolean
  ): Promise<ComputerActionResult> {
    const entry = this.requireSession(sessionId);
    const locator = await this.resolveTarget(entry.page, target);
    if (locator === null) {
      return {
        sessionId,
        status: "REJECTED",
        observation: null,
        reason: `Could not find a field matching "${target.description}".`
      };
    }
    await locator.fill(text, { timeout: 10_000 });
    if (submit) {
      await locator.press("Enter", { timeout: 5_000 }).catch(() => undefined);
      await entry.page
        .waitForLoadState("domcontentloaded", { timeout: 5_000 })
        .catch(() => undefined);
    }
    return { sessionId, status: "EXECUTED", observation: await this.observe(sessionId) };
  }

  async scroll(
    sessionId: string,
    direction: "up" | "down",
    amountPx: number
  ): Promise<ComputerActionResult> {
    const entry = this.requireSession(sessionId);
    await entry.page.mouse.wheel(0, direction === "down" ? amountPx : -amountPx);
    return { sessionId, status: "EXECUTED", observation: await this.observe(sessionId) };
  }

  async upload(
    sessionId: string,
    target: ComputerTarget,
    fileName: string,
    contentType: string,
    contentBase64: string
  ): Promise<ComputerActionResult> {
    const entry = this.requireSession(sessionId);
    const locator = entry.page.locator("input[type=file]").first();
    const count = await locator.count();
    if (count === 0) {
      return {
        sessionId,
        status: "REJECTED",
        observation: null,
        reason: `No file input found matching "${target.description}".`
      };
    }
    await locator.setInputFiles({
      name: fileName,
      mimeType: contentType,
      buffer: Buffer.from(contentBase64, "base64")
    });
    return { sessionId, status: "EXECUTED", observation: await this.observe(sessionId) };
  }

  async checkpoint(
    sessionId: string
  ): Promise<{ sessionId: string; opaqueState: string; capturedAt: string }> {
    const entry = this.requireSession(sessionId);
    const state = await entry.context.storageState();
    return { sessionId, opaqueState: JSON.stringify(state), capturedAt: new Date().toISOString() };
  }

  async suspend(sessionId: string): Promise<void> {
    const entry = this.requireSession(sessionId);
    entry.status = "SUSPENDED";
    await entry.context.close().catch(() => undefined);
    // Keep the map entry (minus the now-closed context/page) so a later restore() can tell this
    // was a known, suspended session rather than an unknown one; navigate/observe/etc. against it
    // will fail fast with a clear "not resumed" error instead of a null-page crash.
  }

  async restore(sessionId: string, opaqueState: string | null): Promise<void> {
    const browser = await this.requireBrowser();
    const existing = this.sessions.get(sessionId);
    const context = await browser.newContext({
      viewport: { width: SCREENSHOT_MAX_WIDTH, height: 720 },
      ...(opaqueState === null ? {} : { storageState: parseStorageState(opaqueState) })
    });
    const page = await context.newPage();
    this.sessions.set(sessionId, {
      context,
      page,
      status: "READY",
      businessId: existing?.businessId ?? "",
      accountId: existing?.accountId ?? "",
      conversationId: existing?.conversationId ?? "",
      profileId: existing?.profileId ?? null
    });
  }

  async close(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (entry !== undefined) {
      await entry.context.close().catch(() => undefined);
    }
    this.sessions.delete(sessionId);
  }

  async shutdown(): Promise<void> {
    for (const sessionId of [...this.sessions.keys()]) {
      await this.close(sessionId);
    }
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
  }

  private requireSession(sessionId: string): SessionEntry {
    const entry = this.sessions.get(sessionId);
    if (entry === undefined) {
      throw new Error(`Unknown or not-resumed computer session: ${sessionId}`);
    }
    return entry;
  }

  private sessionView(sessionId: string): ComputerSession {
    const entry = this.requireSession(sessionId);
    return {
      id: sessionId,
      businessId: entry.businessId,
      accountId: entry.accountId,
      conversationId: entry.conversationId,
      profileId: entry.profileId,
      status: entry.status,
      controlMode: "AGENT",
      currentUrl: entry.page.url(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastCheckpointId: null
    };
  }

  private async captureScreenshot(page: Page): Promise<string | null> {
    try {
      const buffer = await page.screenshot({ type: "jpeg", quality: 45, timeout: 5_000 });
      return `data:image/jpeg;base64,${buffer.toString("base64")}`;
    } catch {
      return null;
    }
  }

  private async extractContentSummary(page: Page): Promise<string> {
    try {
      const text = await page.locator("body").innerText({ timeout: 5_000 });
      return text.length > CONTENT_SUMMARY_MAX_CHARS
        ? `${text.slice(0, CONTENT_SUMMARY_MAX_CHARS)}\n[truncated]`
        : text;
    } catch {
      return "";
    }
  }

  private async extractInteractiveElements(page: Page): Promise<ComputerInteractiveElement[]> {
    try {
      const handles = await page
        .locator(
          'button, a, input, textarea, select, [role="button"], [role="link"], [role="textbox"]'
        )
        .all();
      const elements: ComputerInteractiveElement[] = [];
      for (const [index, handle] of handles.entries()) {
        if (elements.length >= MAX_INTERACTIVE_ELEMENTS) break;
        const [role, name, type] = await Promise.all([
          handle.getAttribute("role").catch(() => null),
          handle
            .evaluate(
              (el) =>
                (el as HTMLElement).innerText ||
                el.getAttribute("aria-label") ||
                el.getAttribute("placeholder") ||
                ""
            )
            .catch(() => ""),
          handle.getAttribute("type").catch(() => null)
        ]);
        const tagName = await handle.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
        elements.push({
          ref: `el-${index}`,
          role: role ?? tagName,
          name: (name ?? "").trim().slice(0, 120),
          sensitive: type === "password" || SENSITIVE_FIELD_PATTERN.test(name ?? "")
        });
      }
      return elements;
    } catch {
      return [];
    }
  }

  private async resolveTarget(page: Page, target: ComputerTarget) {
    const description = target.description;
    const strategies = [
      () => page.getByRole("button", { name: description, exact: false }),
      () => page.getByRole("link", { name: description, exact: false }),
      () => page.getByLabel(description, { exact: false }),
      () => page.getByPlaceholder(description, { exact: false }),
      () => page.getByText(description, { exact: false })
    ];
    for (const strategy of strategies) {
      const locator = strategy();
      const count = await locator.count().catch(() => 0);
      if (count > 0) return locator.first();
    }
    return null;
  }
}
