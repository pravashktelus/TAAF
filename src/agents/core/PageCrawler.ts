import { chromium, firefox, webkit, Browser, Page, BrowserContext } from 'playwright';
import { AgentsConfig } from '../config/AgentsConfig';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Represents a single interactive element discovered on a page.
 */
export interface DiscoveredElement {
  key: string;           // Suggested PascalCase key for .properties file (e.g. BtnSubmit)
  locator: string;       // Best locator found (data-testid > id > role > placeholder > css > xpath)
  type: string;          // Element type: button | input | select | link | textarea | other
  label: string;         // Visible text, placeholder, or aria-label
  tag: string;           // HTML tag name
}

/**
 * Represents a full page snapshot used by Planner and Generator agents.
 */
export interface PageSnapshot {
  url: string;
  title: string;
  elements: DiscoveredElement[];
  navigationLinks: { text: string; href: string }[];
  forms: { id: string; fields: string[] }[];
  rawHTML: string;       // Trimmed HTML of the body for AI context
}

/**
 * PageCrawler
 * -----------
 * Playwright-based DOM explorer used by Planner and Generator agents.
 * Launches a real browser, navigates to a URL, and extracts all
 * interactive elements with their best locators.
 *
 * Runs OUTSIDE of test execution — only invoked by agent CLI scripts.
 * Has NO connection to the test framework's browser/page instances.
 */
export class PageCrawler {
  private config: AgentsConfig;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor() {
    this.config = AgentsConfig.getInstance();
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Launches the browser. Call this before crawling.
   * Usage: await crawler.launch()
   */
  async launch(): Promise<void> {
    const browserType = this.config.browser;
    console.log(`[PageCrawler] Launching ${browserType} browser...`);

    if (browserType === 'firefox') {
      this.browser = await firefox.launch({ headless: true });
    } else if (browserType === 'webkit') {
      this.browser = await webkit.launch({ headless: true });
    } else {
      this.browser = await chromium.launch({ headless: true });
    }

    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
    console.log('[PageCrawler] Browser ready.');
  }

  /**
   * Closes the browser. Always call this after crawling.
   * Usage: await crawler.close()
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
      console.log('[PageCrawler] Browser closed.');
    }
  }

  // ─── Crawling ─────────────────────────────────────────────────────────────

  /**
   * Auto-login using credentials from framework.properties + .env
   * Call this before crawling pages that require authentication.
   * Usage: await crawler.login()
   */
  async login(): Promise<void> {
    if (!this.page) {
      throw new Error('[PageCrawler] Browser not launched. Call launch() first.');
    }

    const loginUrl = this.config.appUrl;
    if (!loginUrl) {
      throw new Error('[PageCrawler] app.url not configured in framework.properties');
    }

    const username = process.env.TEST_USERNAME
      || process.env.TEST_EMAIL
      || this._getStoredCredential('Email')
      || this.config.testUserEmail;

    const password = process.env.TEST_PASSWORD
      || this._getStoredCredential('Password')
      || this.config.testUserPassword;

    if (!username || !password) {
      console.warn('[PageCrawler] Login credentials not found. Skipping login.');
      return;
    }

    console.log(`[PageCrawler] Logging in at: ${loginUrl} with: ${username}`);
    await this.page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForTimeout(1000);

    // Try common login field patterns
    const emailSelectors = [
      "[data-testid='login-email']",
      "[data-testid='email']",
      "input[type='email']",
      "input[name='email']",
      "#email",
    ];

    const passwordSelectors = [
      "[data-testid='login-password']",
      "[data-testid='password']",
      "input[type='password']",
      "input[name='password']",
      "#password",
    ];

    const submitSelectors = [
      "[data-testid='login-submit']",
      "[data-testid='submit']",
      "button[type='submit']",
      "button:has-text('Login')",
      "button:has-text('Sign In')",
    ];

    // Fill email
    for (const sel of emailSelectors) {
      try {
        await this.page.fill(sel, username, { timeout: 2000 });
        console.log(`[PageCrawler] Email filled using: ${sel}`);
        break;
      } catch { continue; }
    }

    // Fill password
    for (const sel of passwordSelectors) {
      try {
        await this.page.fill(sel, password, { timeout: 2000 });
        console.log(`[PageCrawler] Password filled using: ${sel}`);
        break;
      } catch { continue; }
    }

    // Click submit
    for (const sel of submitSelectors) {
      try {
        await this.page.click(sel, { timeout: 2000 });
        console.log(`[PageCrawler] Login submitted using: ${sel}`);
        break;
      } catch { continue; }
    }

    // Wait for navigation after login (URL should change from /login)
    try {
      await this.page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 10000 });
      console.log(`[PageCrawler] Login successful. Current URL: ${this.page.url()}`);
    } catch {
      // Timeout — still on login page, credentials may be invalid
      await this.page.waitForTimeout(2000);
      console.warn(`[PageCrawler] Login may have failed. Current URL: ${this.page.url()}`);
    }
  }

  /**
   * Navigates to a URL and returns a full page snapshot.
   * Usage: const snapshot = await crawler.crawl('https://app.com/orders')
   */
  async crawl(url: string): Promise<PageSnapshot> {
    if (!this.page) {
      throw new Error('[PageCrawler] Browser not launched. Call launch() first.');
    }

    console.log(`[PageCrawler] Navigating to: ${url}`);
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForTimeout(1500); // allow dynamic content to render

    const title = await this.page.title();
    console.log(`[PageCrawler] Page loaded: "${title}"`);

    const elements = await this._extractElements();
    const navigationLinks = await this._extractNavLinks();
    const forms = await this._extractForms();
    const rawHTML = await this._extractBodyHTML();

    const snapshot: PageSnapshot = {
      url,
      title,
      elements,
      navigationLinks,
      forms,
      rawHTML,
    };

    console.log(`[PageCrawler] Discovered ${elements.length} elements, ${navigationLinks.length} nav links, ${forms.length} forms.`);
    return snapshot;
  }

  /**
   * Takes a snapshot of the current page (without navigating).
   * Useful when page state is already set (e.g. after login).
   * Usage: const snapshot = await crawler.snapshotCurrentPage()
   */
  async snapshotCurrentPage(): Promise<PageSnapshot> {
    if (!this.page) {
      throw new Error('[PageCrawler] Browser not launched. Call launch() first.');
    }

    const url = this.page.url();
    const title = await this.page.title();
    const elements = await this._extractElements();
    const navigationLinks = await this._extractNavLinks();
    const forms = await this._extractForms();
    const rawHTML = await this._extractBodyHTML();

    return { url, title, elements, navigationLinks, forms, rawHTML };
  }

  // ─── Private: Element Extraction ──────────────────────────────────────────

  private async _extractElements(): Promise<DiscoveredElement[]> {
    if (!this.page) return [];

    // Extract all interactive elements from the DOM
    const elements = await this.page.evaluate(() => {
      const results: any[] = [];

      const interactiveSelectors = [
        'button',
        'input',
        'select',
        'textarea',
        'nav a[href]',
        'header a[href]',
        '[role="button"]',
        '[role="combobox"]',
        '[role="textbox"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="search"] a',
        '[data-testid]',
        '[data-qa]',
        '[data-cy]',
      ];

      // Also capture top-level nav links (limit to first 20 to avoid category spam)
      const MAX_LINKS = 20;

      const seen = new Set<string>();

      interactiveSelectors.forEach((selector) => {
        const nodes = document.querySelectorAll(selector);
        nodes.forEach((el: Element) => {
          const htmlEl = el as HTMLElement;

          // Skip hidden elements
          const style = window.getComputedStyle(htmlEl);
          if (style.display === 'none' || style.visibility === 'hidden') return;

          // Build the best locator (priority: data-testid > id > role+name > placeholder > css > text)
          let locator = '';
          let locatorType = '';

          const testId = htmlEl.getAttribute('data-testid');
          const dataQa = htmlEl.getAttribute('data-qa');
          const dataCy = htmlEl.getAttribute('data-cy');
          const id = htmlEl.getAttribute('id');
          const placeholder = htmlEl.getAttribute('placeholder');
          const ariaLabel = htmlEl.getAttribute('aria-label');
          const role = htmlEl.getAttribute('role') || el.tagName.toLowerCase();
          const visibleText = htmlEl.textContent?.trim().substring(0, 50) || '';
          const type = (htmlEl as HTMLInputElement).type || '';

          if (testId) {
            locator = `//${el.tagName.toLowerCase()}[@data-testid='${testId}']`;
            locatorType = 'data-testid';
          } else if (dataQa) {
            locator = `//${el.tagName.toLowerCase()}[@data-qa='${dataQa}']`;
            locatorType = 'data-qa';
          } else if (dataCy) {
            locator = `//${el.tagName.toLowerCase()}[@data-cy='${dataCy}']`;
            locatorType = 'data-cy';
          } else if (id) {
            locator = `#${id}`;
            locatorType = 'id';
          } else if (placeholder) {
            locator = `placeholder=${placeholder}`;
            locatorType = 'placeholder';
          } else if (ariaLabel) {
            locator = `role=${role}[name='${ariaLabel}']`;
            locatorType = 'aria';
          } else if (visibleText && el.tagName.toLowerCase() === 'button') {
            locator = `text=${visibleText}`;
            locatorType = 'text';
          } else if (visibleText && el.tagName.toLowerCase() === 'a') {
            locator = `text=${visibleText}`;
            locatorType = 'text';
          } else {
            // fallback: basic CSS
            const classes = Array.from(htmlEl.classList).slice(0, 2).join('.');
            locator = classes ? `.${classes}` : el.tagName.toLowerCase();
            locatorType = 'css';
          }

          // Deduplicate by locator
          if (seen.has(locator)) return;
          seen.add(locator);

          // Determine element type
          let elementType = 'other';
          const tag = el.tagName.toLowerCase();
          if (tag === 'button' || role === 'button') elementType = 'button';
          else if (tag === 'input' && type !== 'hidden') elementType = 'input';
          else if (tag === 'select' || role === 'combobox') elementType = 'select';
          else if (tag === 'textarea') elementType = 'textarea';
          else if (tag === 'a') elementType = 'link';

          // Suggest a PascalCase key — prefer data-testid/data-qa for uniqueness
          const keySource = testId || dataQa || dataCy || '';
          let label = '';
          let key = '';

          if (keySource) {
            // Use data attribute for key: "login-email" → "LoginEmail"
            label = keySource;
            const keyWords = keySource.split(/[-_\s]+/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
            let prefix = '';
            if (elementType === 'button') prefix = 'Btn';
            else if (elementType === 'input') prefix = 'Input';
            else if (elementType === 'select') prefix = 'Select';
            else if (elementType === 'textarea') prefix = 'Input';
            else if (elementType === 'link') prefix = 'Nav';
            key = prefix + keyWords.join('');
          } else {
            // Fallback: try multiple attributes for a meaningful label
            const title = htmlEl.getAttribute('title') || '';
            const name = htmlEl.getAttribute('name') || '';
            const value = (htmlEl as HTMLInputElement).value || '';
            label = ariaLabel || placeholder || title || name || '';
            
            // For buttons: prefer visible text over other attributes
            if (elementType === 'button' && visibleText && visibleText.length > 1 && visibleText.length < 30) {
              label = visibleText;
            }
            // For inputs: prefer placeholder or name
            if (elementType === 'input' && !label && name) {
              label = name;
            }
            // Last resort: use id
            if (!label && id) label = id;

            // Skip elements with no usable label at all
            if (!label || label.length < 2) return;

            const sanitized = label.replace(/[^a-zA-Z0-9\s]/g, '').trim();
            if (!sanitized || sanitized.length < 2) return;

            const words = sanitized.split(/\s+/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
            let prefix = '';
            if (elementType === 'button') prefix = 'Btn';
            else if (elementType === 'input') prefix = 'Input';
            else if (elementType === 'select') prefix = 'Select';
            else if (elementType === 'textarea') prefix = 'Input';
            else if (elementType === 'link') prefix = 'Nav';
            key = prefix + words.slice(0, 4).join('');
          }

          // Skip elements with generic/empty keys (just the prefix with no identifier)
          if (key === 'Btn' || key === 'Input' || key === 'Nav' || key === 'Select' || key.length <= 3) return;

          // Skip duplicate keys — first one wins (use locator-based seen set + key check)
          const keyForDedup = `KEY:${key}`;
          if (seen.has(keyForDedup)) return;
          seen.add(keyForDedup);

          results.push({
            key,
            locator,
            type: elementType,
            label,
            tag,
          });
        });
      });

      // Limit: keep all inputs/buttons/selects, but cap links at MAX_LINKS
      const inputs = results.filter((r: any) => r.type === 'input' || r.type === 'select' || r.type === 'textarea' || r.type === 'button');
      const links = results.filter((r: any) => r.type === 'link').slice(0, MAX_LINKS);
      const others = results.filter((r: any) => r.type === 'other');
      return [...inputs, ...links, ...others];
    });

    return elements as DiscoveredElement[];
  }

  private async _extractNavLinks(): Promise<{ text: string; href: string }[]> {
    if (!this.page) return [];

    return this.page.evaluate(() => {
      const links: { text: string; href: string }[] = [];
      const navElements = document.querySelectorAll('nav a, [role="navigation"] a, header a');

      navElements.forEach((el) => {
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
      const formElements = document.querySelectorAll('form');

      formElements.forEach((form, index) => {
        const id = form.getAttribute('id') || `form-${index + 1}`;
        const fields: string[] = [];

        form.querySelectorAll('input, select, textarea').forEach((field) => {
          const htmlField = field as HTMLInputElement;
          const fieldId = htmlField.getAttribute('id') || '';
          const placeholder = htmlField.getAttribute('placeholder') || '';
          const name = htmlField.getAttribute('name') || '';
          const label = fieldId || placeholder || name || field.tagName.toLowerCase();
          if (label) fields.push(label);
        });

        forms.push({ id, fields });
      });

      return forms;
    });
  }

  private async _extractBodyHTML(): Promise<string> {
    if (!this.page) return '';

    // Return trimmed body HTML (max 5000 chars) for AI context — enough for AI to understand structure
    return this.page.evaluate(() => {
      const body = document.body?.innerHTML || '';
      // Strip script/style tags to reduce noise
      const cleaned = body
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      return cleaned.substring(0, 5000);
    });
  }

  // ─── Step Replay (for Generator — navigates app using test case steps) ───

  /**
   * Replays test case steps on the live application.
   * Uses page snapshots to find elements by matching step action text
   * against visible element labels, text content, data-testid, or placeholder.
   *
   * After reaching the target page (final step), captures all elements with real XPaths.
   *
   * @param steps - Test case steps from plan (action, testData)
   * @param appUrl - Application starting URL
   * @returns Array of PageSnapshots captured at key navigation points
   */
  async replaySteps(
    steps: { action: string; testData: string; expected: string }[],
    appUrl: string
  ): Promise<PageSnapshot[]> {
    if (!this.page) {
      throw new Error('[PageCrawler] Browser not launched. Call launch() first.');
    }

    const snapshots: PageSnapshot[] = [];
    let previousUrl = '';

    // Navigate to starting URL
    console.log(`[PageCrawler] Replay: navigating to ${appUrl}`);
    await this.page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForTimeout(1500);

    for (const step of steps) {
      const action = step.action.toLowerCase();

      try {
        if (action.includes('enter') || action.includes('type') || action.includes('fill')) {
          // Input action — find the field and type
          const fieldHint = this._extractElementHint(step.action);
          const value = step.testData || '';
          await this._findAndFill(fieldHint, value);
          console.log(`[PageCrawler] Replay: entered "${value.substring(0, 20)}${value.length > 20 ? '...' : ''}" into "${fieldHint}"`);

        } else if (action.includes('click') || action.includes('press') || action.includes('submit')) {
          // Click action — find the element and click
          const elementHint = this._extractElementHint(step.action);
          await this._findAndClick(elementHint);
          console.log(`[PageCrawler] Replay: clicked "${elementHint}"`);

          // Wait for potential navigation/page change
          await this.page.waitForTimeout(2000);

          // If URL changed → capture snapshot of new page
          const currentUrl = this.page.url();
          if (currentUrl !== previousUrl) {
            console.log(`[PageCrawler] Replay: page changed → ${currentUrl}`);
            const snapshot = await this.snapshotCurrentPage();
            snapshots.push(snapshot);
            previousUrl = currentUrl;
          }

        } else if (action.includes('select') || action.includes('dropdown')) {
          // Select/dropdown action
          const fieldHint = this._extractElementHint(step.action);
          const value = step.testData || '';
          await this._findAndSelect(fieldHint, value);
          console.log(`[PageCrawler] Replay: selected "${value}" from "${fieldHint}"`);

        } else if (action.includes('navigate') || action.includes('go to') || action.includes('open')) {
          // Navigation action — check if URL is in test data or action text
          const urlMatch = step.testData?.match(/https?:\/\/[^\s]+/) || step.action.match(/https?:\/\/[^\s]+/);
          if (urlMatch) {
            await this.page.goto(urlMatch[0], { waitUntil: 'domcontentloaded', timeout: 30000 });
            await this.page.waitForTimeout(1500);
            const snapshot = await this.snapshotCurrentPage();
            snapshots.push(snapshot);
            previousUrl = this.page.url();
            console.log(`[PageCrawler] Replay: navigated to ${urlMatch[0]}`);
          }
        }
      } catch (error) {
        console.warn(`[PageCrawler] Replay: step "${step.action}" failed — ${error}. Continuing...`);
      }
    }

    // Final snapshot of current page (the target page)
    const finalSnapshot = await this.snapshotCurrentPage();
    if (snapshots.length === 0 || snapshots[snapshots.length - 1].url !== finalSnapshot.url) {
      snapshots.push(finalSnapshot);
    }

    console.log(`[PageCrawler] Replay complete: captured ${snapshots.length} page snapshot(s)`);
    return snapshots;
  }

  // ─── Private: Step Replay Helpers ──────────────────────────────────────────

  /**
   * Extracts the element hint/name from step action text.
   * e.g. "Enter email into SigninEmail" → "SigninEmail"
   * e.g. "Click BtnSignIn" → "BtnSignIn"
   * e.g. "Click NavOrders" → "NavOrders"
   */
  private _extractElementHint(action: string): string {
    // Pattern: "Enter X into ELEMENT" or "Click ELEMENT" or "Select X from ELEMENT"
    const intoMatch = action.match(/into\s+['"]?([A-Za-z_]+)['"]?\s*$/i);
    if (intoMatch) return intoMatch[1];

    const fromMatch = action.match(/from\s+['"]?([A-Za-z_]+)['"]?\s*$/i);
    if (fromMatch) return fromMatch[1];

    const clickMatch = action.match(/(?:click|press|submit)\s+['"]?([A-Za-z_]+)['"]?\s*$/i);
    if (clickMatch) return clickMatch[1];

    // Fallback: find any PascalCase word (likely element name)
    const pascalMatch = action.match(/([A-Z][a-z]+[A-Z][a-zA-Z]*)/);
    if (pascalMatch) return pascalMatch[1];

    // Last resort: last word
    const words = action.trim().split(/\s+/);
    return words[words.length - 1];
  }

  /**
   * Finds an element on the page by matching hint against visible attributes.
   * Tries: data-testid → placeholder → aria-label → visible text → partial text
   */
  private async _findAndFill(hint: string, value: string): Promise<void> {
    if (!this.page) return;
    const hintLower = hint.toLowerCase();

    // Strategy 1: data-testid contains hint
    const testIdSelectors = [
      `[data-testid*='${hintLower}']`,
      `[data-testid*='${hintLower.replace(/([A-Z])/g, '-$1').toLowerCase()}']`, // camelCase → kebab-case
      `input[data-testid*='${hintLower}']`,
      `textarea[data-testid*='${hintLower}']`,
    ];

    for (const sel of testIdSelectors) {
      try {
        const el = this.page.locator(sel).first();
        if (await el.isVisible({ timeout: 1500 })) {
          await el.fill(value, { timeout: 3000 });
          return;
        }
      } catch { continue; }
    }

    // Strategy 2: placeholder contains hint
    try {
      const placeholderEl = this.page.locator(`[placeholder*='${hint}' i]`).first();
      if (await placeholderEl.isVisible({ timeout: 1500 })) {
        await placeholderEl.fill(value, { timeout: 3000 });
        return;
      }
    } catch { /* continue */ }

    // Strategy 3: aria-label contains hint
    try {
      const ariaEl = this.page.locator(`[aria-label*='${hint}' i]`).first();
      if (await ariaEl.isVisible({ timeout: 1500 })) {
        await ariaEl.fill(value, { timeout: 3000 });
        return;
      }
    } catch { /* continue */ }

    // Strategy 4: label text contains hint, find associated input
    try {
      const labelEl = this.page.locator(`label:has-text("${hint}")`).first();
      if (await labelEl.isVisible({ timeout: 1000 })) {
        const forAttr = await labelEl.getAttribute('for');
        if (forAttr) {
          await this.page.fill(`#${forAttr}`, value, { timeout: 3000 });
          return;
        }
      }
    } catch { /* continue */ }

    // Strategy 5: type into first visible input/textarea (last resort for forms)
    console.warn(`[PageCrawler] Could not find field "${hint}" — trying visible inputs`);
    try {
      const inputs = this.page.locator('input:visible, textarea:visible');
      const count = await inputs.count();
      for (let i = 0; i < count; i++) {
        const input = inputs.nth(i);
        const placeholder = await input.getAttribute('placeholder') || '';
        const testId = await input.getAttribute('data-testid') || '';
        if (placeholder.toLowerCase().includes(hintLower) || testId.toLowerCase().includes(hintLower)) {
          await input.fill(value, { timeout: 3000 });
          return;
        }
      }
    } catch { /* give up */ }
  }

  /**
   * Finds a clickable element by matching hint against visible attributes and text.
   */
  private async _findAndClick(hint: string): Promise<void> {
    if (!this.page) return;
    const hintLower = hint.toLowerCase();

    // Strategy 1: data-testid contains hint
    const testIdSelectors = [
      `[data-testid*='${hintLower}']`,
      `[data-testid*='${hintLower.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '')}']`,
      `button[data-testid*='${hintLower}']`,
      `a[data-testid*='${hintLower}']`,
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

    // Strategy 2: button/link with text matching hint
    const textVariants = [
      hint,
      hint.replace(/^Btn/, ''),            // BtnSignIn → SignIn
      hint.replace(/^Nav/, ''),            // NavOrders → Orders
      hint.replace(/([A-Z])/g, ' $1').trim(), // BtnSignIn → Btn Sign In
      hint.replace(/^Btn/, '').replace(/([A-Z])/g, ' $1').trim(), // BtnSignIn → Sign In
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

    // Strategy 3: any clickable element with aria-label matching
    try {
      const ariaEl = this.page.locator(`[aria-label*='${hint}' i]`).first();
      if (await ariaEl.isVisible({ timeout: 1500 })) {
        await ariaEl.click({ timeout: 3000 });
        return;
      }
    } catch { /* continue */ }

    console.warn(`[PageCrawler] Could not find clickable element "${hint}"`);
  }

  /**
   * Finds a select/dropdown element and selects a value.
   */
  private async _findAndSelect(hint: string, value: string): Promise<void> {
    if (!this.page) return;
    const hintLower = hint.toLowerCase();

    // Try select element
    try {
      const sel = this.page.locator(`select[data-testid*='${hintLower}'], select[name*='${hintLower}']`).first();
      if (await sel.isVisible({ timeout: 1500 })) {
        await sel.selectOption({ label: value }, { timeout: 3000 });
        return;
      }
    } catch { /* continue */ }

    // Try combobox/dropdown button
    try {
      const btn = this.page.locator(`[data-testid*='${hintLower}'][role='combobox'], button[data-testid*='${hintLower}']`).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click({ timeout: 3000 });
        await this.page.waitForTimeout(500);
        // Click option with matching text
        const option = this.page.locator(`[role="option"]:has-text("${value}"), li:has-text("${value}")`).first();
        if (await option.isVisible({ timeout: 2000 })) {
          await option.click({ timeout: 3000 });
          return;
        }
      }
    } catch { /* continue */ }

    console.warn(`[PageCrawler] Could not find dropdown "${hint}" or select "${value}"`);
  }

  // ─── Utility ──────────────────────────────────────────────────────────────

  /**
   * Returns current page instance (for advanced usage in agents).
   */
  getPage(): Page | null {
    return this.page;
  }

  /**
   * Logs in and then navigates to a target URL.
   * Use when the target page requires authentication.
   * Returns the snapshot of the TARGET page (not the login page).
   *
   * Usage: const snapshot = await crawler.loginAndNavigate('https://app.com/orders')
   */
  async loginAndNavigate(targetUrl: string): Promise<PageSnapshot> {
    if (!this.page) {
      throw new Error('[PageCrawler] Browser not launched. Call launch() first.');
    }

    // Step 1: Login
    await this.login();

    // Step 2: Wait for post-login navigation to settle
    await this.page.waitForTimeout(1500);
    const postLoginUrl = this.page.url();
    console.log(`[PageCrawler] Post-login URL: ${postLoginUrl}`);

    // Step 3: Navigate to target URL
    console.log(`[PageCrawler] Navigating to target: ${targetUrl}`);
    await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForTimeout(2000); // allow dynamic content to render

    // Step 4: Verify we're actually on the target page (not redirected back to login)
    const currentUrl = this.page.url();
    if (currentUrl.includes('login') || currentUrl.includes('signin')) {
      console.warn(`[PageCrawler] ⚠️  Still on login page after login attempt. Credentials may be invalid.`);
      console.warn(`[PageCrawler] ⚠️  Current URL: ${currentUrl}`);
    }

    // Step 5: Capture the target page snapshot
    return this.snapshotCurrentPage();
  }

  /**
   * Reads credentials from testdata/runtime-store.json (persisted from previous test runs).
   */
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

  /**
   * Formats a PageSnapshot as a readable string for AI prompts.
   * Usage: const context = PageCrawler.snapshotToText(snapshot)
   */
  static snapshotToText(snapshot: PageSnapshot): string {
    const lines: string[] = [];

    lines.push(`Page: ${snapshot.title}`);
    lines.push(`URL: ${snapshot.url}`);
    lines.push('');

    if (snapshot.navigationLinks.length > 0) {
      lines.push('Navigation Links:');
      snapshot.navigationLinks.forEach((link) => {
        lines.push(`  - ${link.text} (${link.href})`);
      });
      lines.push('');
    }

    if (snapshot.forms.length > 0) {
      lines.push('Forms:');
      snapshot.forms.forEach((form) => {
        lines.push(`  Form "${form.id}": fields → ${form.fields.join(', ')}`);
      });
      lines.push('');
    }

    if (snapshot.elements.length > 0) {
      lines.push('Interactive Elements:');
      snapshot.elements.forEach((el) => {
        lines.push(`  [${el.type}] Key: ${el.key} | Locator: ${el.locator} | Label: "${el.label}"`);
      });
    }

    return lines.join('\n');
  }
}
