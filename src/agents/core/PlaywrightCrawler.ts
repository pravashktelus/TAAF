import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { AgentsConfig } from '../config/AgentsConfig';
import { DiscoveredElement, PageSnapshot } from './PageCrawler';
import * as fs from 'fs';
import * as path from 'path';

// ─── Credential Masking ─────────────────────────────────────────────────────

/**
 * Detects if a value looks like a credential (email, password, token, key).
 */
function _isCredentialValue(value: string, fieldHint: string = ''): boolean {
  const hintLower = fieldHint.toLowerCase();
  // Field hint indicates a sensitive field
  if (hintLower.match(/password|passwd|secret|token|key|auth|credential/)) return true;
  // Value looks like an email
  if (value.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return true;
  // Value looks like a password (has mixed chars, special chars, reasonable length)
  if (value.length >= 6 && value.match(/[A-Z]/) && value.match(/[a-z]/) && value.match(/[0-9!@#$%^&*]/)) return true;
  return false;
}

/**
 * Masks a credential value for console display: shows first 2 chars + *****
 */
function _maskValue(value: string): string {
  if (!value || value.length <= 2) return '*****';
  return value.substring(0, 2) + '*****';
}

/**
 * PlaywrightCrawler
 * --------------------
 * Replacement for PageCrawler that uses Playwright's accessibility snapshot
 * (the same approach as Playwright server) to discover page elements.
 *
 * Key differences from the old PageCrawler:
 * - Uses `page.accessibility.snapshot()` style approach via ariaSnapshot
 * - Scrolls through the full page to ensure lazy-loaded content is captured
 * - Extracts elements from the accessibility tree
 * - Produces richer, more reliable locators based on data-testid priority
 * - Handles long pages with scrolling to ensure all elements are discovered
 *
 * The output format (PageSnapshot, DiscoveredElement) remains the same
 * so PlannerAgent and GeneratorAgent work without changes.
 */
export class PlaywrightCrawler {
  private config: AgentsConfig;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor() {
    this.config = AgentsConfig.getInstance();
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async launch(): Promise<void> {
    const browserType = this.config.browser;
    console.log(`[Crawler] Launching ${browserType} browser...`);

    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    this.page = await this.context.newPage();
    console.log('[Crawler] Browser ready.');
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
      console.log('[Crawler] Browser closed.');
    }
  }

  // ─── Crawling ─────────────────────────────────────────────────────────────

  async login(): Promise<void> {
    if (!this.page) throw new Error('[Crawler] Browser not launched.');

    const loginUrl = this.config.appUrl;
    if (!loginUrl) throw new Error('[Crawler] app.url not configured.');

    const username = process.env.TEST_USERNAME
      || process.env.TEST_EMAIL
      || this._getStoredCredential('Email')
      || this.config.testUserEmail;

    const password = process.env.TEST_PASSWORD
      || this._getStoredCredential('Password')
      || this.config.testUserPassword;

    if (!username || !password) {
      console.warn('[Crawler] Login credentials not found. Skipping login.');
      return;
    }

    console.log(`[Crawler] Logging in at: ${loginUrl} with: ${_maskValue(username)}`);
    await this.page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForTimeout(1500);

    // Use accessibility snapshot to find login fields
    const loginElements = await this._getAccessibilityElements();

    // Find and fill the email/username field (must be an input-like element,
    // NOT a button/link). Prefer email-typed inputs and email/username signals.
    const emailField = this._findLoginField(loginElements, ['email', 'username', 'userid', 'user-id', 'login-id', 'account']);
    if (emailField) {
      await this.page.locator(emailField.locator).first().fill(username);
      console.log(`[Crawler] Email filled using: ${emailField.locator}`);
    } else {
      console.warn('[Crawler] Could not locate an email/username field.');
    }

    // Find and fill the password field (input signalling password).
    const passwordField = this._findLoginField(loginElements, ['password', 'passwd', 'pwd', 'pass']);
    if (passwordField) {
      await this.page.locator(passwordField.locator).first().fill(password);
      console.log(`[Crawler] Password filled using: ${passwordField.locator}`);
    } else {
      console.warn('[Crawler] Could not locate a password field.');
    }

    // Find and click the SUBMIT BUTTON. Critically, this must be an actual
    // button/submit — never an <input> field. Matching an input (e.g. an element
    // whose testid merely contains "login") would "submit" nothing and leave the
    // page on /login. We score button-like candidates by submit signals.
    const submitBtn = this._findSubmitButton(loginElements, ['login-submit', 'sign-in', 'sign in', 'signin', 'log in', 'login', 'submit', 'continue']);
    if (submitBtn) {
      await this.page.locator(submitBtn.locator).first().click();
      console.log(`[Crawler] Login submitted using: ${submitBtn.locator}`);
    } else {
      // Last-resort: press Enter in the password field to trigger form submit.
      if (passwordField) {
        await this.page.locator(passwordField.locator).first().press('Enter');
        console.log('[Crawler] No submit button found — pressed Enter in password field.');
      } else {
        console.warn('[Crawler] Could not locate a submit button.');
      }
    }

    // Wait for navigation
    try {
      await this.page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 10000 });
      console.log(`[Crawler] Login successful. URL: ${this.page.url()}`);
    } catch {
      await this.page.waitForTimeout(2000);
      console.warn(`[Crawler] Login may have failed. URL: ${this.page.url()}`);
    }
  }

  /**
   * Crawls a page using accessibility snapshot approach.
   * Scrolls through the entire page to ensure all elements are captured.
   */
  async crawl(url: string): Promise<PageSnapshot> {
    if (!this.page) throw new Error('[Crawler] Browser not launched.');

    console.log(`[Crawler] Navigating to: ${url}`);
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForTimeout(2000);

    const title = await this.page.title();
    console.log(`[Crawler] Page loaded: "${title}"`);

    // Scroll through the page to trigger lazy-loaded content
    await this._scrollFullPage();

    // Capture elements using accessibility snapshot + data-testid enrichment
    const elements = await this._getAccessibilityElements();
    const navigationLinks = await this._extractNavLinks();
    const forms = await this._extractForms();
    const rawHTML = await this._extractBodyHTML();

    const snapshot: PageSnapshot = {
      url: this.page.url(),
      title,
      elements,
      navigationLinks,
      forms,
      rawHTML,
    };

    console.log(`[Crawler] Discovered ${elements.length} elements, ${navigationLinks.length} nav links, ${forms.length} forms.`);
    return snapshot;
  }

  async snapshotCurrentPage(): Promise<PageSnapshot> {
    if (!this.page) throw new Error('[Crawler] Browser not launched.');

    // Wait for dynamic frameworks (Vue, React, Angular) to finish hydration/rendering
    await this.page.waitForLoadState('networkidle').catch(() => {});
    await this.page.waitForTimeout(500);
    await this._scrollFullPage();

    const url = this.page.url();
    const title = await this.page.title();
    const elements = await this._getAccessibilityElements();
    const navigationLinks = await this._extractNavLinks();
    const forms = await this._extractForms();
    const rawHTML = await this._extractBodyHTML();

    return { url, title, elements, navigationLinks, forms, rawHTML };
  }

  async loginAndNavigate(targetUrl: string): Promise<PageSnapshot> {
    if (!this.page) throw new Error('[Crawler] Browser not launched.');
    await this.login();
    await this.page.waitForTimeout(1500);

    console.log(`[Crawler] Navigating to target: ${targetUrl}`);
    await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForTimeout(2000);

    return this.snapshotCurrentPage();
  }

  // ─── Core: Accessibility Snapshot Element Extraction ───────────────────────

  /**
   * Uses Playwright's accessibility tree
   * combined with data-testid attribute scanning to discover all interactive elements.
   *
   * This captures ALL elements regardless of scroll position because the accessibility
   * tree represents the full DOM, not just the viewport.
   */
  private async _getAccessibilityElements(): Promise<DiscoveredElement[]> {
    if (!this.page) return [];

    const results: DiscoveredElement[] = [];
    const seenKeys = new Set<string>();

    try {
      // ── Phase 1: Get data-testid elements (highest priority locators) ──────
      const dataTestElements = await this.page.evaluate(() => {
        const items: {
          testId: string;
          attrName: string;
          tag: string;
          type: string;
          placeholder: string;
          ariaLabel: string;
          text: string;
          inputType: string;
          role: string;
        }[] = [];

        document.querySelectorAll('[data-testid], [data-test], [data-qa], [data-cy]').forEach((el) => {
          const htmlEl = el as HTMLElement;
          // Skip hidden elements
          if (htmlEl.offsetParent === null && htmlEl.tagName.toLowerCase() !== 'input') return;

          // Determine which attribute is present (priority order)
          let testId = '';
          let attrName = '';
          if (el.getAttribute('data-test')) {
            testId = el.getAttribute('data-test')!;
            attrName = 'data-test';
          } else if (el.getAttribute('data-testid')) {
            testId = el.getAttribute('data-testid')!;
            attrName = 'data-testid';
          } else if (el.getAttribute('data-qa')) {
            testId = el.getAttribute('data-qa')!;
            attrName = 'data-qa';
          } else if (el.getAttribute('data-cy')) {
            testId = el.getAttribute('data-cy')!;
            attrName = 'data-cy';
          }

          if (!testId) return;

          items.push({
            testId,
            attrName,
            tag: el.tagName.toLowerCase(),
            type: (el as HTMLInputElement).type || '',
            // Use DOM property .placeholder (not getAttribute) — property reflects current rendered state
            placeholder: (el as HTMLInputElement).placeholder || '',
            ariaLabel: el.getAttribute('aria-label') || '',
            text: (htmlEl.textContent || '').trim().substring(0, 50),
            inputType: (el as HTMLInputElement).type || '',
            role: el.getAttribute('role') || '',
          });
        });

        return items;
      });

      // Process data-test/data-testid elements
      for (const item of dataTestElements) {
        const locator = `//${item.tag}[@${item.attrName}='${item.testId}']`;

        // Determine element type
        let elementType = this._inferElementType(item.tag, item.inputType, item.role);

        // Generate key with proper prefix
        const prefix = this._getKeyPrefix(elementType);
        const keyWords = item.testId
          .split(/[-_\s]+/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
        const key = prefix + keyWords.join('');

        if (key.length <= 3 || seenKeys.has(key)) continue;
        seenKeys.add(key);

        const label = item.ariaLabel || item.placeholder || item.text || item.testId;

        results.push({ key, locator, type: elementType, label, tag: item.tag });
      }

      // ── Phase 2: Get interactive elements via DOM query (role-based) ────────
      const interactiveElements = await this.page.evaluate(() => {
        const items: {
          tag: string;
          id: string;
          name: string;
          placeholder: string;
          ariaLabel: string;
          role: string;
          text: string;
          inputType: string;
          hasTestId: boolean;
        }[] = [];

        const selectors = 'button, input, select, textarea, a[href], [role="button"], [role="link"], [role="combobox"], [role="checkbox"], [role="radio"], [role="tab"], [role="switch"]';

        document.querySelectorAll(selectors).forEach((el) => {
          const htmlEl = el as HTMLElement;
          // Skip hidden
          if (htmlEl.offsetParent === null && htmlEl.tagName.toLowerCase() !== 'input') return;
          // Skip if already has data-testid/data-test (handled in Phase 1)
          if (el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-qa') || el.getAttribute('data-cy')) return;
          // Skip hidden inputs
          if ((el as HTMLInputElement).type === 'hidden') return;

          items.push({
            tag: el.tagName.toLowerCase(),
            id: el.getAttribute('id') || '',
            name: el.getAttribute('name') || '',
            // Use DOM property .placeholder (not getAttribute) — property reflects current rendered state
            placeholder: (el as HTMLInputElement).placeholder || '',
            ariaLabel: el.getAttribute('aria-label') || '',
            role: el.getAttribute('role') || '',
            text: (htmlEl.textContent || '').trim().substring(0, 50),
            inputType: (el as HTMLInputElement).type || '',
            hasTestId: false,
          });
        });

        return items;
      });

      // Process interactive elements with locator priority
      for (const item of interactiveElements) {
        let locator = '';
        let label = '';

        // Locator priority: id > aria-label > placeholder > name > role+name > text
        // (placeholder preferred over name for form inputs — framework standard)
        if (item.id) {
          locator = `#${item.id}`;
          label = item.ariaLabel || item.placeholder || item.id;
        } else if (item.ariaLabel) {
          const role = item.role || this._implicitRole(item.tag, item.inputType);
          locator = `role=${role}[name='${item.ariaLabel.replace(/'/g, "\\'")}']`;
          label = item.ariaLabel;
        } else if (item.placeholder && (item.tag === 'input' || item.tag === 'textarea')) {
          locator = `placeholder=${item.placeholder}`;
          label = item.placeholder;
        } else if (item.name && (item.tag === 'input' || item.tag === 'select' || item.tag === 'textarea')) {
          locator = `//${item.tag}[@name='${item.name}']`;
          label = item.name;
        } else if (item.text && item.text.length > 1 && item.text.length < 40) {
          if (item.tag === 'button' || item.role === 'button') {
            locator = `role=button[name='${item.text.replace(/'/g, "\\'")}']`;
          } else if (item.tag === 'a') {
            locator = `role=link[name='${item.text.replace(/'/g, "\\'")}']`;
          } else {
            locator = `text=${item.text}`;
          }
          label = item.text;
        } else {
          continue; // Skip elements without usable locator
        }

        const elementType = this._inferElementType(item.tag, item.inputType, item.role);
        const prefix = this._getKeyPrefix(elementType);

        // Generate key from label
        const sanitized = (label || '').replace(/[^a-zA-Z0-9\s]/g, '').trim();
        if (!sanitized || sanitized.length < 2) continue;
        const words = sanitized.split(/[\s-_]+/).slice(0, 4)
          .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
        const key = prefix + words.join('');

        if (key.length <= 3 || seenKeys.has(key)) continue;
        seenKeys.add(key);

        results.push({ key, locator, type: elementType, label, tag: item.tag });
      }

      console.log(`[Crawler] Accessibility extraction: ${dataTestElements.length} data-testid + ${interactiveElements.length} interactive → ${results.length} total elements`);
      return results;

    } catch (error) {
      console.warn(`[Crawler] Element extraction failed: ${error}`);
      return [];
    }
  }

  // ─── Scrolling (ensures lazy-loaded content is rendered) ──────────────────

  /**
   * Scrolls through the full page height to ensure all lazy-loaded or
   * virtualized content is rendered before element extraction.
   */
  private async _scrollFullPage(): Promise<void> {
    if (!this.page) return;

    const scrollHeight = await this.page.evaluate(() => document.body.scrollHeight);
    const viewportHeight = await this.page.evaluate(() => window.innerHeight);
    const scrollSteps = Math.ceil(scrollHeight / viewportHeight);

    if (scrollSteps <= 1) return; // Page fits in viewport, no scroll needed

    console.log(`[Crawler] Page requires scrolling (${scrollSteps} steps)...`);

    for (let i = 1; i <= scrollSteps; i++) {
      await this.page.evaluate((step) => {
        window.scrollTo(0, step * window.innerHeight);
      }, i);
      await this.page.waitForTimeout(300); // Allow lazy content to render
    }

    // Scroll back to top
    await this.page.evaluate(() => window.scrollTo(0, 0));
    await this.page.waitForTimeout(500);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private _inferElementType(tag: string, inputType: string, role: string): string {
    if (tag === 'button' || role === 'button' || inputType === 'submit') return 'button';
    if (tag === 'input' || tag === 'textarea') return 'input';
    if (tag === 'select' || role === 'combobox') return 'select';
    if (tag === 'a' || role === 'link') return 'link';
    if (role === 'checkbox' || role === 'radio' || inputType === 'checkbox' || inputType === 'radio') return 'input';
    return 'other';
  }

  private _getKeyPrefix(elementType: string): string {
    switch (elementType) {
      case 'button': return 'Btn';
      case 'input': return 'Input';
      case 'select': return 'Select';
      case 'link': return 'Nav';
      default: return '';
    }
  }

  private _implicitRole(tag: string, inputType: string): string {
    if (tag === 'button') return 'button';
    if (tag === 'a') return 'link';
    if (tag === 'select') return 'combobox';
    if (tag === 'input' && inputType === 'checkbox') return 'checkbox';
    if (tag === 'input' && inputType === 'radio') return 'radio';
    if (tag === 'input') return 'textbox';
    if (tag === 'textarea') return 'textbox';
    return 'generic';
  }

  private _findElementByHints(elements: DiscoveredElement[], hints: string[]): DiscoveredElement | undefined {
    for (const hint of hints) {
      const match = elements.find((el) =>
        el.label.toLowerCase().includes(hint) ||
        el.key.toLowerCase().includes(hint) ||
        el.locator.toLowerCase().includes(hint)
      );
      if (match) return match;
    }
    return undefined;
  }

  /**
   * Finds a login INPUT field (email/username/password) generically.
   *
   * A field must be input-like (input/textbox/textarea) — never a button or
   * link. Among input-like elements, we score by how strongly the element's
   * locator/label/key matches the given signals, and rank the best match.
   * This prevents, e.g., a submit button or a nav link from being treated as
   * the email field, and works for any app's login form.
   */
  private _findLoginField(elements: DiscoveredElement[], signals: string[]): DiscoveredElement | undefined {
    const inputs = elements.filter((el) => {
      const t = (el.type || '').toLowerCase();
      const tag = (el.tag || '').toLowerCase();
      // Accept text inputs / textboxes; exclude buttons, links, selects, checkboxes/radios.
      if (t === 'button' || t === 'link' || t === 'select') return false;
      return tag === 'input' || tag === 'textarea' || t === 'input' || t === 'textbox';
    });

    let best: { el: DiscoveredElement; score: number } | undefined;
    for (const el of inputs) {
      const hay = `${el.locator} ${el.label} ${el.key}`.toLowerCase();
      let score = 0;
      signals.forEach((sig, i) => {
        if (hay.includes(sig)) score += (signals.length - i) * 10; // earlier signals weigh more
      });
      // Strong bonus for the native input type (type=email / type=password).
      if (signals.includes('password') && /type='?password/.test(hay)) score += 50;
      if (signals.includes('email') && /type='?email/.test(hay)) score += 40;
      if (score > 0 && (!best || score > best.score)) best = { el, score };
    }
    return best?.el;
  }

  /**
   * Finds the login SUBMIT button generically.
   *
   * Only real button-like elements are eligible (button tag, role=button,
   * or input[type=submit]). We NEVER return a text/email/password input, which
   * was the root cause of "submitting" against the email field. Candidates are
   * scored by submit signals; a generic button still wins over no button.
   */
  private _findSubmitButton(elements: DiscoveredElement[], signals: string[]): DiscoveredElement | undefined {
    const buttons = elements.filter((el) => {
      const t = (el.type || '').toLowerCase();
      const tag = (el.tag || '').toLowerCase();
      return t === 'button' || tag === 'button';
    });
    if (buttons.length === 0) return undefined;

    let best: { el: DiscoveredElement; score: number } | undefined;
    for (const el of buttons) {
      const hay = `${el.locator} ${el.label} ${el.key}`.toLowerCase();
      // Never treat a switch/register/social button as the login submit.
      if (/switch-to|register|sign-?up|create-account|google|facebook|apple/.test(hay)) continue;
      let score = 1; // any eligible button beats nothing
      signals.forEach((sig, i) => {
        if (hay.includes(sig)) score += (signals.length - i) * 10;
      });
      if (!best || score > best.score) best = { el, score };
    }
    return best?.el;
  }

  private async _extractNavLinks(): Promise<{ text: string; href: string }[]> {
    if (!this.page) return [];
    return this.page.evaluate(() => {
      const links: { text: string; href: string }[] = [];
      document.querySelectorAll('nav a, [role="navigation"] a, header a').forEach((el) => {
        const text = el.textContent?.trim() || '';
        const href = el.getAttribute('href') || '';
        if (text && href && !href.startsWith('javascript')) {
          links.push({ text, href });
        }
      });
      return links;
    });
  }

  private async _extractForms(): Promise<{ id: string; fields: string[] }[]> {
    if (!this.page) return [];
    return this.page.evaluate(() => {
      const forms: { id: string; fields: string[] }[] = [];
      document.querySelectorAll('form').forEach((form, index) => {
        const id = form.getAttribute('id') || `form-${index + 1}`;
        const fields: string[] = [];
        form.querySelectorAll('input, select, textarea').forEach((field) => {
          const htmlField = field as HTMLInputElement;
          const label = htmlField.getAttribute('id') || htmlField.getAttribute('placeholder') || htmlField.getAttribute('name') || field.tagName.toLowerCase();
          if (label) fields.push(label);
        });
        forms.push({ id, fields });
      });
      return forms;
    });
  }

  private async _extractBodyHTML(): Promise<string> {
    if (!this.page) return '';
    return this.page.evaluate(() => {
      const body = document.body?.innerHTML || '';
      return body
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 5000);
    });
  }

  private _getStoredCredential(key: string): string {
    try {
      const storePath = path.resolve(process.cwd(), 'testdata', 'runtime-store.json');
      if (!fs.existsSync(storePath)) return '';
      const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
      return store[key] || '';
    } catch {
      return '';
    }
  }

  // ─── Step Replay ──────────────────────────────────────────────────────────

  /**
   * Replays test case steps using accessibility-based element discovery.
   */
  async replaySteps(
    steps: { action: string; testData: string; expected: string }[],
    appUrl: string
  ): Promise<PageSnapshot[]> {
    if (!this.page) throw new Error('[Crawler] Browser not launched.');

    const snapshots: PageSnapshot[] = [];
    let previousUrl = '';
    const snapshotedUrls = new Set<string>();

    console.log(`[Crawler] Replay: navigating to ${appUrl}`);
    await this.page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForTimeout(1500);

    // Snapshot the initial landing page (captures elements before any interaction)
    const initialSnapshot = await this.snapshotCurrentPage();
    snapshots.push(initialSnapshot);
    previousUrl = this.page.url();
    snapshotedUrls.add(previousUrl);

    for (const step of steps) {
      const action = step.action.toLowerCase();

      try {
        if (action.includes('enter') || action.includes('type') || action.includes('fill')) {
          const fieldHint = this._extractElementHint(step.action);
          const value = step.testData || '';
          await this._smartFill(fieldHint, value);
          const displayValue = _isCredentialValue(value, fieldHint) ? _maskValue(value) : value.substring(0, 20);
          console.log(`[Crawler] Replay: entered "${displayValue}" into "${fieldHint}"`);

        } else if (action.includes('click') || action.includes('press') || action.includes('submit')) {
          const elementHint = this._extractElementHint(step.action);

          // Snapshot BEFORE clicking if we haven't captured this page yet
          // (handles case where we navigated here via click but filled forms before next click)
          const preClickUrl = this.page.url();
          if (!snapshotedUrls.has(preClickUrl)) {
            const preSnapshot = await this.snapshotCurrentPage();
            snapshots.push(preSnapshot);
            snapshotedUrls.add(preClickUrl);
            console.log(`[Crawler] Replay: pre-click snapshot at ${preClickUrl}`);
          }

          await this._smartClick(elementHint);
          console.log(`[Crawler] Replay: clicked "${elementHint}"`);
          
          // Wait for potential navigation — try waitForURL change first, fall back to timeout
          try {
            await this.page.waitForURL((url) => url.toString() !== preClickUrl, { timeout: 5000 });
            console.log(`[Crawler] Replay: URL changed after click → ${this.page.url()}`);
          } catch {
            // No navigation happened — just wait a bit for any dynamic content
            await this.page.waitForTimeout(2000);
          }

          const currentUrl = this.page.url();
          if (currentUrl !== previousUrl) {
            console.log(`[Crawler] Replay: page changed → ${currentUrl}`);
            if (!snapshotedUrls.has(currentUrl)) {
              const snapshot = await this.snapshotCurrentPage();
              snapshots.push(snapshot);
              snapshotedUrls.add(currentUrl);
            }
            previousUrl = currentUrl;
          }

        } else if (action.includes('select') || action.includes('dropdown')) {
          const fieldHint = this._extractElementHint(step.action);
          const value = step.testData || '';
          await this._smartSelect(fieldHint, value);
          console.log(`[Crawler] Replay: selected "${value}" from "${fieldHint}"`);

        } else if (action.includes('navigate') || action.includes('go to') || action.includes('open')) {
          const urlMatch = step.testData?.match(/https?:\/\/[^\s]+/) || step.action.match(/https?:\/\/[^\s]+/);
          if (urlMatch) {
            await this.page.goto(urlMatch[0], { waitUntil: 'domcontentloaded', timeout: 30000 });
            await this.page.waitForTimeout(1500);
            const currentUrl = this.page.url();
            if (!snapshotedUrls.has(currentUrl)) {
              const snapshot = await this.snapshotCurrentPage();
              snapshots.push(snapshot);
              snapshotedUrls.add(currentUrl);
            }
            previousUrl = currentUrl;
          }
        }
      } catch (error) {
        console.warn(`[Crawler] Replay: step "${step.action}" failed — ${error}. Continuing...`);
      }
    }

    // Final snapshot if we're on a new page
    const finalUrl = this.page.url();
    if (!snapshotedUrls.has(finalUrl)) {
      const finalSnapshot = await this.snapshotCurrentPage();
      snapshots.push(finalSnapshot);
    }

    console.log(`[Crawler] Replay complete: ${snapshots.length} snapshot(s)`);
    return snapshots;
  }

  // ─── AI-Driven Crawl (intelligent page exploration) ────────────────────────

  /**
   * Uses LLM to intelligently navigate through an application flow.
   * Instead of parsing story text into replay steps, this method:
   * 1. Takes a page snapshot
   * 2. Asks AI "what should I do next?" based on story goal + current page
   * 3. Executes the AI's action
   * 4. Repeats until flow is complete
   *
   * This handles complex multi-page flows (registration, wizards, etc.)
   * where simple hint-matching fails.
   */
  async aiDrivenCrawl(storyContent: string, startUrl: string, maxSteps: number = 30): Promise<PageSnapshot[]> {
    if (!this.page) throw new Error('[Crawler] Browser not launched.');

    const { LLMClient } = await import('./LLMClient');
    const snapshots: PageSnapshot[] = [];
    const snapshotedUrls = new Set<string>();
    let stepCount = 0;
    const actionHistory: string[] = [];
    let lastAction = '';
    let repeatCount = 0;

    // Load minimal knowledge for crawler (keep tokens low — full bank used by Planner/Generator)
    const knowledgeContext = `## Quick Reference
- Registration: fill name → email → password → click submit
- Wizard: fill ALL Input*/Select* fields on current step → click BtnNext → repeat
- Dropdowns: use Select* element keys with option text values
- Dates: use "1990-05-15" format
- Phones: use "9876543210"
- Addresses: use "123 Test Street"
- IDs: use "123456789012"
- Gender: use "Male"
- Done = see OrderSuccess/order-success element`;

    console.log(`[Crawler] AI-Driven Crawl: starting at ${startUrl}`);
    await this.page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForTimeout(2000);

    // Initial snapshot
    let currentSnapshot = await this.snapshotCurrentPage();
    snapshots.push(currentSnapshot);
    snapshotedUrls.add(this.page.url());

    const systemPrompt = `You are a browser automation agent navigating a web application step by step.
Your goal is to walk through the ENTIRE user story flow, interacting with every page to discover all elements.

${knowledgeContext ? '## Framework Knowledge\n' + knowledgeContext.substring(0, 3000) + '\n' : ''}

RULES:
- Return ONLY a JSON object with ONE action. No explanation, no markdown.
- Actions: {"action": "click", "target": "element key or text"}
          {"action": "fill", "target": "element key", "value": "text to enter"}
          {"action": "select", "target": "element key", "value": "option to select"}
          {"action": "done"} — ONLY when you see a final success/confirmation element (e.g., OrderSuccess, OrderNumber, "Thank you", confirmation ID). Do NOT say done just because a page changed.
- Use the EXACT element key names from the "Visible Elements" list as targets (e.g., "BtnSwitchToRegister" not "switch-to-register")
- For fill actions, target should match an Input* element key from the list
- For click actions, target should match a Btn* or Nav* element key
- For registration: use name="TestUser Auto", email="testauto${Date.now()}@test.com", password="TestPass@123"
- CRITICAL: You MUST fill ALL visible Input* and Select* fields BEFORE clicking any Btn* submit/next button. Never skip fields.
- For form fields requiring dates: use "1990-05-15"
- For phone numbers: use "9876543210"
- For addresses: use "123 Test Street"
- For ID numbers: use "123456789012"
- Fill ALL required fields before clicking submit/next
- After registration success, navigate to dashboard, start new connection, complete all wizard steps
- For multi-step wizards: fill visible fields → click Next → repeat for each step
- For dropdowns/selects: use the SelectXxx element key as target
- NEVER repeat the same action twice. If an action was already performed (see history), move to the NEXT step.
- If fill action failed previously, try a different target or skip that field.
- IMPORTANT: Progress through the ENTIRE flow described in the story — don't stop early.
- NEVER navigate backwards — if you're in a wizard (Step 2, Step 3, etc.), DON'T click Nav links or buttons that go back to earlier pages.
- In a wizard: fill ALL visible Input*/Select* fields on the CURRENT step → click BtnNext or BtnSubmit → move to the NEXT step.
- If you see Select* elements (dropdowns) on the current step, fill them with reasonable values BEFORE clicking Next.
- If fill action failed previously, try a different target or skip that field.`;

    while (stepCount < maxSteps) {
      stepCount++;

      // Build page context for AI — include action history to prevent loops
      const pageUrl = this.page.url();
      const pageTitle = await this.page.title();
      
      // Filter elements: if we're in a form/wizard (URL contains /order, /signup, /register),
      // only show actionable elements (Input, Select, Btn) — hide Nav links to prevent backward navigation
      const isInFormFlow = pageUrl.includes('/order') || pageUrl.includes('/signup') || pageUrl.includes('/register');
      const filteredElements = isInFormFlow
        ? currentSnapshot.elements.filter(el => el.key.startsWith('Input') || el.key.startsWith('Select') || el.key.startsWith('Btn'))
        : currentSnapshot.elements;
      
      const elements = filteredElements.map(el => 
        `  ${el.key} [${el.type}] → ${el.locator}`
      ).join('\n');

      const historyText = actionHistory.length > 0
        ? `\n## Actions Already Performed (DO NOT REPEAT):\n${actionHistory.slice(-10).join('\n')}`
        : '';

      const userPrompt = `## Story Goal (DO NOT stop until Order Success page is reached)
${storyContent.substring(0, 2000)}

## Definition of Done: The flow is COMPLETE only when you see an element containing "OrderSuccess" or "Order Number" or "order-success". Until then, KEEP GOING.

## Current Page
URL: ${pageUrl}
Title: ${pageTitle}

## Visible Elements (use these EXACT keys as targets):
${elements}
${historyText}

## What is the ONE next action to perform?
Return ONLY JSON. Say {"action": "done"} ONLY if you see "OrderSuccess" or "order-success" in the element list above. Otherwise, keep filling fields and clicking Next/Submit.`;

      try {
        const aiResponse = await LLMClient.askWithSystem(systemPrompt, userPrompt, '{"action": "done"}');
        
        // Parse AI response
        const jsonMatch = aiResponse.match(/\{[^}]+\}/);
        if (!jsonMatch) {
          console.warn(`[Crawler] AI returned non-JSON: ${aiResponse.substring(0, 100)}`);
          break;
        }

        const decision = JSON.parse(jsonMatch[0]);
        
        if (decision.action === 'done') {
          console.log(`[Crawler] AI-Driven Crawl: flow complete (${stepCount} steps)`);
          break;
        }

        // Detect repeated actions — break loop
        const actionKey = `${decision.action}:${decision.target}:${decision.value || ''}`;
        if (actionKey === lastAction) {
          repeatCount++;
          if (repeatCount >= 2) {
            console.warn(`[Crawler] AI repeating action "${decision.target}" — skipping, refreshing snapshot`);
            currentSnapshot = await this.snapshotCurrentPage();
            actionHistory.push(`SKIPPED (repeated): ${actionKey}`);
            repeatCount = 0;
            lastAction = '';
            continue;
          }
        } else {
          repeatCount = 0;
          lastAction = actionKey;
        }

        const previousUrl = this.page.url();

        if (decision.action === 'click') {
          console.log(`[Crawler] AI Step ${stepCount}: click "${decision.target}"`);
          // Try to resolve target as an element key from current snapshot
          const matchedEl = currentSnapshot.elements.find(el => 
            el.key === decision.target || el.key.toLowerCase() === decision.target.toLowerCase()
          );
          if (matchedEl) {
            try {
              await this.page.locator(matchedEl.locator).first().click({ timeout: 5000 });
            } catch {
              await this._smartClick(decision.target);
            }
          } else {
            await this._smartClick(decision.target);
          }
          actionHistory.push(`✓ Clicked: ${decision.target}`);
        } else if (decision.action === 'fill') {
          const displayVal = (decision.value || '').substring(0, 20);
          console.log(`[Crawler] AI Step ${stepCount}: fill "${decision.target}" with "${displayVal}..."`);
          // Try to resolve target as an element key from current snapshot
          const matchedEl = currentSnapshot.elements.find(el => 
            el.key === decision.target || el.key.toLowerCase() === decision.target.toLowerCase()
          );
          if (matchedEl) {
            try {
              await this.page.locator(matchedEl.locator).first().fill(decision.value || '', { timeout: 5000 });
            } catch {
              await this._smartFill(decision.target, decision.value || '');
            }
          } else {
            await this._smartFill(decision.target, decision.value || '');
          }
          actionHistory.push(`✓ Filled: ${decision.target} = "${displayVal}..."`);
        } else if (decision.action === 'select') {
          console.log(`[Crawler] AI Step ${stepCount}: select "${decision.value}" from "${decision.target}"`);
          // Try to resolve target as an element key from current snapshot
          const matchedEl = currentSnapshot.elements.find(el => 
            el.key === decision.target || el.key.toLowerCase() === decision.target.toLowerCase()
          );
          if (matchedEl) {
            try {
              await this.page.locator(matchedEl.locator).first().selectOption({ label: decision.value || '' }, { timeout: 5000 });
            } catch {
              await this._smartSelect(decision.target, decision.value || '');
            }
          } else {
            await this._smartSelect(decision.target, decision.value || '');
          }
          actionHistory.push(`✓ Selected: ${decision.value} from ${decision.target}`);
        } else {
          console.warn(`[Crawler] AI returned unknown action: ${decision.action}`);
          break;
        }

        // Wait for potential navigation
        try {
          await this.page.waitForURL((url) => url.toString() !== previousUrl, { timeout: 3000 });
        } catch {
          await this.page.waitForTimeout(1000);
        }

        // ALWAYS refresh snapshot after every action (captures dynamic content changes)
        const newUrl = this.page.url();
        currentSnapshot = await this.snapshotCurrentPage();
        
        if (newUrl !== previousUrl && !snapshotedUrls.has(newUrl)) {
          snapshots.push(currentSnapshot);
          snapshotedUrls.add(newUrl);
          console.log(`[Crawler] AI-Driven Crawl: new page → ${newUrl} (${currentSnapshot.elements.length} elements)`);
        } else {
          // Same URL — merge new elements into existing snapshot
          const existingIdx = snapshots.findIndex(s => s.url === newUrl);
          if (existingIdx >= 0) {
            let newCount = 0;
            currentSnapshot.elements.forEach(el => {
              if (!snapshots[existingIdx].elements.some(e => e.locator === el.locator)) {
                snapshots[existingIdx].elements.push(el);
                newCount++;
              }
            });
            if (newCount > 0) {
              console.log(`[Crawler] AI-Driven Crawl: +${newCount} new elements on ${newUrl}`);
            }
          }
        }

      } catch (error) {
        console.warn(`[Crawler] AI Step ${stepCount} failed: ${error}. Continuing...`);
        actionHistory.push(`✗ Failed: step ${stepCount}`);
        currentSnapshot = await this.snapshotCurrentPage();
      }
    }

    if (stepCount >= maxSteps) {
      console.warn(`[Crawler] AI-Driven Crawl: hit max steps (${maxSteps}). Flow may be incomplete.`);
    }

    console.log(`[Crawler] AI-Driven Crawl complete: ${snapshots.length} pages, ${snapshots.reduce((sum, s) => sum + s.elements.length, 0)} total elements`);
    return snapshots;
  }

  // ─── Smart Interaction (accessibility-driven) ─────────────────────────────

  private async _smartFill(hint: string, value: string): Promise<void> {
    if (!this.page) return;
    const hintLower = hint.toLowerCase();
    // Extract the most meaningful keyword from multi-word hints
    // "Email address" → "email", "Password" → "password", "First name" → "first-name"
    const keywords = hintLower.split(/\s+/).filter((w) => !['the', 'field', 'input', 'text', 'box', '*'].includes(w));
    const primaryKeyword = keywords[0] || hintLower;
    const hyphenated = keywords.join('-');

    // Try data-test / data-testid / data-qa first (using primary keyword)
    // When multiple elements match, prefer the LAST visible one (signup sections are typically after login sections)
    const testIdSelectors = [
      `[data-qa="${primaryKeyword}"]`,
      `[data-qa*="signup-${primaryKeyword}"]`,
      `[data-qa*="${primaryKeyword}"]`,
      `[data-test="${primaryKeyword}"]`,
      `[data-test*="${primaryKeyword}"]`,
      `[data-test*="${hyphenated}"]`,
      `[data-testid*="${primaryKeyword}"]`,
    ];
    for (const sel of testIdSelectors) {
      try {
        const el = this.page.locator(sel).last();
        if (await el.isVisible({ timeout: 1500 })) {
          const dataQa = await el.getAttribute('data-qa').catch(() => '');
          console.log(`[Crawler] SmartFill: "${hint}" → matched selector: ${sel} (data-qa=${dataQa})`);
          await el.fill(value, { timeout: 3000 });
          return;
        }
      } catch { continue; }
    }

    // Try placeholder — prefer last match (signup section comes after login section in DOM)
    const placeholderAttempts = [hint, primaryKeyword, ...keywords];
    for (const ph of placeholderAttempts) {
      try {
        const el = this.page.locator(`[placeholder*="${ph}" i]`).last();
        if (await el.isVisible({ timeout: 1500 })) {
          await el.fill(value, { timeout: 3000 });
          return;
        }
      } catch { continue; }
    }

    // Try aria-label
    try {
      const el = this.page.locator(`[aria-label*="${hint}" i]`).last();
      if (await el.isVisible({ timeout: 1500 })) {
        await el.fill(value, { timeout: 3000 });
        return;
      }
    } catch { /* continue */ }

    console.warn(`[Crawler] Could not find field "${hint}"`);
  }

  private async _smartClick(hint: string): Promise<void> {
    if (!this.page) return;
    const hintLower = hint.toLowerCase();

    // Try data-test / data-testid
    const testIdSelectors = [
      `[data-test*="${hintLower}"]`,
      `[data-testid*="${hintLower}"]`,
      `[data-test*="${hintLower.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '')}"]`,
    ];
    for (const sel of testIdSelectors) {
      try {
        const el = this.page.locator(sel).first();
        if (await el.isVisible({ timeout: 1500 })) {
          await el.click({ timeout: 3000 });
          return;
        }
      } catch { continue; }
    }

    // Try text match on buttons/links
    const textVariants = [
      hint,
      hint.replace(/^Btn/, ''),
      hint.replace(/^Nav/, ''),
      hint.replace(/([A-Z])/g, ' $1').trim(),
      hint.replace(/^Btn/, '').replace(/([A-Z])/g, ' $1').trim(),
    ];
    for (const text of textVariants) {
      try {
        const el = this.page.locator(`button:has-text("${text}"), a:has-text("${text}"), [role="button"]:has-text("${text}")`).first();
        if (await el.isVisible({ timeout: 1500 })) {
          await el.click({ timeout: 3000 });
          return;
        }
      } catch { continue; }
    }

    console.warn(`[Crawler] Could not find clickable "${hint}"`);
  }

  private async _smartSelect(hint: string, value: string): Promise<void> {
    if (!this.page) return;
    const hintLower = hint.toLowerCase();

    try {
      const sel = this.page.locator(`select[data-test*="${hintLower}"], select[data-testid*="${hintLower}"], select[name*="${hintLower}"]`).first();
      if (await sel.isVisible({ timeout: 1500 })) {
        await sel.selectOption({ label: value }, { timeout: 3000 });
        return;
      }
    } catch { /* continue */ }

    console.warn(`[Crawler] Could not find dropdown "${hint}"`);
  }

  private _extractElementHint(action: string): string {
    // Match: into "Email address" or into the "Email address" or into 'Email address'
    const intoQuotedMatch = action.match(/into\s+(?:the\s+)?["']([^"']+)["']/i);
    if (intoQuotedMatch) return intoQuotedMatch[1];

    const intoMatch = action.match(/into\s+(?:the\s+)?['"]?([A-Za-z_]+)['"]?\s*$/i);
    if (intoMatch) return intoMatch[1];

    // Match: from "Country" or from the "Country" dropdown
    const fromQuotedMatch = action.match(/from\s+(?:the\s+)?["']([^"']+)["']/i);
    if (fromQuotedMatch) return fromQuotedMatch[1];

    const fromMatch = action.match(/from\s+(?:the\s+)?['"]?([A-Za-z_]+)['"]?\s*$/i);
    if (fromMatch) return fromMatch[1];

    // Match: Click "Login" or Click the 'Sign in' button
    const clickQuotedMatch = action.match(/(?:click|press|submit|check)\s+(?:the\s+)?["']([^"']+)["']/i);
    if (clickQuotedMatch) return clickQuotedMatch[1].trim();

    const clickMatch = action.match(/(?:click|press|submit)\s+['"]?([A-Za-z_]+)['"]?\s*$/i);
    if (clickMatch) return clickMatch[1];

    const pascalMatch = action.match(/([A-Z][a-z]+[A-Z][a-zA-Z]*)/);
    if (pascalMatch) return pascalMatch[1];

    const words = action.trim().split(/\s+/);
    return words[words.length - 1];
  }

  // ─── Static Utility ───────────────────────────────────────────────────────

  static snapshotToText(snapshot: PageSnapshot): string {
    const lines: string[] = [];
    lines.push(`Page: ${snapshot.title}`);
    lines.push(`URL: ${snapshot.url}`);
    lines.push('');

    if (snapshot.navigationLinks.length > 0) {
      lines.push('Navigation Links:');
      snapshot.navigationLinks.forEach((link) => lines.push(`  - ${link.text} (${link.href})`));
      lines.push('');
    }

    if (snapshot.forms.length > 0) {
      lines.push('Forms:');
      snapshot.forms.forEach((form) => lines.push(`  Form "${form.id}": fields → ${form.fields.join(', ')}`));
      lines.push('');
    }

    if (snapshot.elements.length > 0) {
      lines.push('Interactive Elements (locators are CASE-EXACT from live DOM — use verbatim):');
      snapshot.elements.forEach((el) => lines.push(`  [${el.type}] Key: ${el.key} | Locator: ${el.locator} | Label: "${el.label}"`));
    }

    return lines.join('\n');
  }

  getPage(): Page | null {
    return this.page;
  }
}
