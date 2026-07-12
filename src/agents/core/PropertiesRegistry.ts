import * as fs from 'fs';
import * as path from 'path';

/**
 * Represents a single registered element from an existing .properties file.
 */
export interface RegisteredElement {
  pageName: string;       // e.g. "TeleConnect" (= .properties filename without extension)
  elementKey: string;     // e.g. "LoginSubmit"
  locator: string;        // e.g. "//button[@data-testid='login-submit']"
  ref: string;            // e.g. "TeleConnect.LoginSubmit" (used in feature files)
  propertiesFile: string; // full path to .properties file
}

/**
 * Result of an element lookup.
 */
export interface ElementMatch {
  source: 'existing' | 'new';
  ref: string;                        // existing: "TeleConnect.LoginSubmit" | new: "Orders.BtnSubmit"
  registeredElement?: RegisteredElement; // populated when source = existing
}

/**
 * PropertiesRegistry
 * ------------------
 * Scans all existing .properties files and builds an in-memory registry.
 * Used by PlannerAgent and GeneratorAgent to avoid duplicating locators.
 *
 * Matching rule:
 *   page name matches .properties filename (case-insensitive)
 *   AND locator matches element in that file
 *   → reuse existing (source: existing)
 *
 *   Otherwise → new element, add to current page's .properties (source: new)
 */
export class PropertiesRegistry {
  private elements: RegisteredElement[] = [];
  private propertiesDir: string;
  private loaded = false;

  constructor() {
    this.propertiesDir = path.resolve(process.cwd(), 'src', 'pages', 'properties');
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Loads all .properties files into registry.
   * Call once before using findMatch().
   */
  load(): void {
    if (this.loaded) return;
    this.elements = [];

    if (!fs.existsSync(this.propertiesDir)) {
      console.warn(`[PropertiesRegistry] Properties directory not found: ${this.propertiesDir}`);
      this.loaded = true;
      return;
    }

    const files = fs.readdirSync(this.propertiesDir)
      .filter((f) => f.endsWith('.properties'));

    for (const file of files) {
      const pageName = path.basename(file, '.properties');
      const filePath = path.join(this.propertiesDir, file);
      this._parseFile(filePath, pageName);
    }

    console.log(`[PropertiesRegistry] Loaded ${this.elements.length} elements from ${files.length} properties files.`);
    this.loaded = true;
  }

  /**
   * Checks if a discovered element already exists in the registry.
   *
   * Rule:
   *   page name matches .properties filename (case-insensitive)
   *   AND locator matches → source: existing, return existing ref
   *   Otherwise           → source: new, return new PageName.ElementKey ref
   *
   * @param locator      - Locator discovered on the live page
   * @param currentPage  - Page name being processed (e.g. "TeleConnect", "Orders")
   * @param suggestedKey - Suggested element key if new (e.g. "BtnSubmit")
   */
  findMatch(
    locator: string,
    currentPage: string,
    suggestedKey: string
  ): ElementMatch {
    if (!this.loaded) this.load();

    const normLocator = locator.trim();
    const normPage = currentPage.toLowerCase();

    // Find element where BOTH page name AND locator match
    const match = this.elements.find(
      (e) =>
        e.pageName.toLowerCase() === normPage &&
        e.locator.trim() === normLocator
    );

    if (match) {
      return {
        source: 'existing',
        ref: match.ref,
        registeredElement: match,
      };
    }

    // No match → new element for current page
    return {
      source: 'new',
      ref: `${currentPage}.${suggestedKey}`,
    };
  }

  /**
   * Returns all registered elements for a given page name.
   */
  getPageElements(pageName: string): RegisteredElement[] {
    if (!this.loaded) this.load();
    return this.elements.filter(
      (e) => e.pageName.toLowerCase() === pageName.toLowerCase()
    );
  }

  /**
   * Returns all registered page names.
   */
  getPageNames(): string[] {
    if (!this.loaded) this.load();
    return [...new Set(this.elements.map((e) => e.pageName))];
  }

  /**
   * Returns total element count in registry.
   */
  get size(): number {
    return this.elements.length;
  }

  // ─── Private: File Parsing ────────────────────────────────────────────────

  private _parseFile(filePath: string, pageName: string): void {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;

      const key = trimmed.substring(0, eqIndex).trim();
      const locator = trimmed.substring(eqIndex + 1).trim();

      if (key && locator) {
        this.elements.push({
          pageName,
          elementKey: key,
          locator,
          ref: `${pageName}.${key}`,
          propertiesFile: filePath,
        });
      }
    }
  }
}
