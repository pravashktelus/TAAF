import * as fs from 'fs';
import * as path from 'path';

/**
 * A locator discovered directly from the application source code.
 */
export interface SourceLocator {
  testid: string;        // raw data-testid value, e.g. "input-name" or "order-card-" (template base)
  key: string;           // PascalCase element key, e.g. "InputName"
  locator: string;       // XPath built from the testid
  isDynamic: boolean;    // true when the testid came from a template literal (`order-card-${i}`)
  route: string;         // the app route the file maps to, e.g. "/customer/order"
  page: string;          // suggested page/module name, e.g. "Customer" (derived from route)
  file: string;          // source file (relative to repo root)
}

/**
 * A validation rule + its user-facing message, extracted from source.
 * Used to generate HONEST negative-case assertions (real messages, not guesses).
 */
export interface SourceValidation {
  field: string;         // field key, e.g. "customerName"
  message: string;       // exact user-facing message, e.g. "Full name is required"
  errorTestid?: string;  // the data-testid of the element that renders it, e.g. "error-customerName"
  errorKey?: string;     // PascalCase key for the error element, e.g. "ErrorCustomerName"
  route: string;         // route where the validation lives
  file: string;
}

/**
 * The full index produced by scanning the app source repo.
 */
export interface SourceIndex {
  repoPath: string;
  scannedAt: string;
  routes: string[];                        // all discovered app routes
  locators: SourceLocator[];               // all data-testid locators
  validations: SourceValidation[];         // all validation messages
  statusValues: string[];                  // e.g. SUBMITTED, CRM_APPROVED, ACTIVATED
}

/**
 * SourceRepoScanner
 * -----------------
 * Reads a LOCAL clone of the application's source repository and extracts the
 * "inside-out" signals that the live-DOM crawl cannot reliably provide:
 *
 *   1. data-testid locators for EVERY page (including pages behind auth / deep
 *      in wizards that a crawler struggles to reach)
 *   2. Application routes (from the Next.js App Router folder structure)
 *   3. Field validation rules + their EXACT user-facing error messages, plus the
 *      error-element testids that render them (kills negative-case hallucination)
 *   4. Order/status enum values
 *
 * It is read-only and never modifies the app repo. Output is a SourceIndex that
 * the Planner/Generator consume as an authoritative locator + validation source.
 *
 * Framework-agnostic where possible; tuned for Next.js App Router + React/TSX,
 * which is the current dev app's stack.
 */
export class SourceRepoScanner {
  private repoPath: string;
  private srcAppDir: string;
  private srcComponentsDir: string;

  constructor(repoPath: string) {
    this.repoPath = path.resolve(repoPath);
    this.srcAppDir = path.join(this.repoPath, 'src', 'app');
    this.srcComponentsDir = path.join(this.repoPath, 'src', 'components');
  }

  /** Returns true if the configured repo path exists and looks like the app source. */
  isAvailable(): boolean {
    return fs.existsSync(this.repoPath) && fs.existsSync(this.srcAppDir);
  }

  /**
   * Scans the repo and returns a full SourceIndex.
   */
  scan(): SourceIndex {
    const tsxFiles = [
      ...this._findFiles(this.srcAppDir, /\.tsx$/),
      ...this._findFiles(this.srcComponentsDir, /\.tsx$/),
    ];

    const locators: SourceLocator[] = [];
    const validations: SourceValidation[] = [];
    const routeSet = new Set<string>();
    const statusSet = new Set<string>();

    for (const file of tsxFiles) {
      const rel = path.relative(this.repoPath, file);
      const route = this._routeForFile(file);
      if (route) routeSet.add(route);
      const page = this._pageNameForRoute(route);
      const content = fs.readFileSync(file, 'utf-8');

      this._extractLocators(content, route, page, rel, locators);
      this._extractValidations(content, route, rel, validations);
      this._extractStatusValues(content, statusSet);
    }

    // Attach error-element testids to validations by matching field name.
    this._linkValidationErrorElements(validations, locators);

    // De-duplicate locators by testid+route (keep first occurrence).
    const seen = new Set<string>();
    const dedupLocators = locators.filter((l) => {
      const k = `${l.route}::${l.testid}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    return {
      repoPath: this.repoPath,
      scannedAt: new Date().toISOString(),
      routes: [...routeSet].sort(),
      locators: dedupLocators,
      validations,
      statusValues: [...statusSet].sort(),
    };
  }

  /**
   * Writes the index to a cache file for the Planner/Generator to read.
   */
  writeIndex(index: SourceIndex, outPath: string): void {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(index, null, 2), 'utf-8');
  }

  // ─── Private: extraction ───────────────────────────────────────────────────

  /**
   * Extracts data-testid values from JSX. Handles:
   *   - static:   data-testid="input-name"
   *   - template: data-testid={`order-card-${index}`}  → base "order-card-" (dynamic)
   */
  private _extractLocators(
    content: string,
    route: string,
    page: string,
    file: string,
    out: SourceLocator[]
  ): void {
    // Static string testids: data-testid="value" or data-testid='value'
    const staticRe = /data-testid\s*=\s*["']([^"'{}]+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = staticRe.exec(content)) !== null) {
      const testid = m[1].trim();
      if (!testid) continue;
      out.push({
        testid,
        key: this._testidToKey(testid),
        locator: `//*[@data-testid='${testid}']`,
        isDynamic: false,
        route,
        page,
        file,
      });
    }

    // Template-literal testids: data-testid={`order-card-${index}`}
    const tmplRe = /data-testid\s*=\s*\{`([^`]*?)\$\{[^`]*`\}/g;
    while ((m = tmplRe.exec(content)) !== null) {
      const base = (m[1] || '').trim(); // e.g. "order-card-"
      if (!base) continue;
      out.push({
        testid: base,
        key: this._testidToKey(base.replace(/[-_]$/, '')),
        // Dynamic → use contains() so any generated suffix matches
        locator: `//*[contains(@data-testid,'${base}')]`,
        isDynamic: true,
        route,
        page,
        file,
      });
    }
  }

  /**
   * Extracts inline validation messages of the form:
   *   errors.customerName = "Full name is required";
   *   errors["customerName"] = 'Email is required';
   * Also captures Zod-style `.min(n, "message")` / `message: "..."` where present.
   */
  private _extractValidations(
    content: string,
    route: string,
    file: string,
    out: SourceValidation[]
  ): void {
    // Inline object-assignment style: errors.field = "message"
    const inlineRe = /errors\.([A-Za-z0-9_]+)\s*=\s*["'`]([^"'`]+)["'`]/g;
    let m: RegExpExecArray | null;
    while ((m = inlineRe.exec(content)) !== null) {
      out.push({ field: m[1], message: m[2].trim(), route, file });
    }

    // Bracket style: errors["field"] = "message"
    const bracketRe = /errors\[\s*["']([A-Za-z0-9_]+)["']\s*\]\s*=\s*["'`]([^"'`]+)["'`]/g;
    while ((m = bracketRe.exec(content)) !== null) {
      out.push({ field: m[1], message: m[2].trim(), route, file });
    }

    // Zod-style messages: .min(3, "message") / .email("message") / message: "..."
    const zodRe = /\.(?:min|max|email|regex|nonempty|length)\(\s*(?:[^,]*,\s*)?["']([^"']+)["']\s*\)/g;
    while ((m = zodRe.exec(content)) !== null) {
      out.push({ field: '(zod)', message: m[1].trim(), route, file });
    }
  }

  /**
   * Collects status-enum-like SCREAMING_SNAKE tokens (order lifecycle states).
   */
  private _extractStatusValues(content: string, out: Set<string>): void {
    // Known telecom lifecycle statuses appear as string literals in source.
    const statusRe = /["'](SUBMITTED|CRM_REVIEW|CRM_APPROVED|CRM_REJECTED|INSTALLATION_SCHEDULED|INSTALLATION_COMPLETE|ACTIVATION_PENDING|ACTIVATED|REJECTED)["']/g;
    let m: RegExpExecArray | null;
    while ((m = statusRe.exec(content)) !== null) {
      out.add(m[1]);
    }
  }

  /**
   * Links each validation to the error-element testid that renders it, by
   * matching the field name against error-* testids (e.g. field "customerName"
   * → testid "error-customerName" → key "ErrorCustomerName").
   */
  private _linkValidationErrorElements(
    validations: SourceValidation[],
    locators: SourceLocator[]
  ): void {
    const errorLocators = locators.filter((l) => /^error-/i.test(l.testid));
    for (const v of validations) {
      const match = errorLocators.find(
        (l) => l.testid.toLowerCase() === `error-${v.field.toLowerCase()}`
      );
      if (match) {
        v.errorTestid = match.testid;
        v.errorKey = match.key;
      }
    }
  }

  // ─── Private: routing + naming ──────────────────────────────────────────────

  /**
   * Derives the Next.js App Router route for a file under src/app.
   * e.g. src/app/customer/order/page.tsx → "/customer/order"
   *      src/app/login/page.tsx          → "/login"
   * Files outside src/app (components) return "" (shared).
   */
  private _routeForFile(file: string): string {
    const relApp = path.relative(this.srcAppDir, file);
    if (relApp.startsWith('..')) return ''; // not under src/app (e.g. components)
    const dir = path.dirname(relApp);
    if (dir === '.' ) return '/';
    // Strip Next.js route groups like (auth) and drop the filename.
    const segments = dir.split(path.sep).filter((s) => s && !/^\(.*\)$/.test(s));
    return '/' + segments.join('/');
  }

  /**
   * Suggests a page/module name from a route.
   * e.g. "/customer/order" → "Customer", "/crm" → "Crm", "/login" → "Login"
   * The first meaningful segment becomes the page (matches .properties convention).
   */
  private _pageNameForRoute(route: string): string {
    if (!route || route === '/') return 'Home';
    const first = route.split('/').filter(Boolean)[0] || 'App';
    return first.charAt(0).toUpperCase() + first.slice(1);
  }

  /**
   * Converts a data-testid into a PascalCase element key.
   * e.g. "input-name" → "InputName", "btn-submit-order" → "BtnSubmitOrder",
   *      "select-id-type" → "SelectIdType", "error-customerName" → "ErrorCustomerName"
   */
  private _testidToKey(testid: string): string {
    return testid
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((part) =>
        // Preserve internal camelCase (customerName) while capitalizing the first char.
        part.charAt(0).toUpperCase() + part.slice(1)
      )
      .join('');
  }

  // ─── Private: file walking ──────────────────────────────────────────────────

  private _findFiles(dir: string, pattern: RegExp): string[] {
    if (!fs.existsSync(dir)) return [];
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next') continue;
        results.push(...this._findFiles(full, pattern));
      } else if (entry.isFile() && pattern.test(entry.name)) {
        results.push(full);
      }
    }
    return results;
  }
}
