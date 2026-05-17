import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/Logger';

/**
 * Resolves a "Page.ElementKey" string into an actual Playwright locator string
 * by reading the corresponding <Page>.properties file.
 */
export class ElementResolver {
  private static cache: Map<string, Record<string, string>> = new Map();

  private static readonly PROPERTIES_DIR = path.resolve(
    __dirname,
    '../pages/properties'
  );

  public static resolve(reference: string): string {
    const parts = reference.split('.');
    if (parts.length < 2) {
      throw new Error(
        `Invalid element reference "${reference}". Expected format: PageName.ElementKey`
      );
    }

    const [pageName, ...keyParts] = parts;
    const elementKey = keyParts.join('.');

    const properties = this.loadPage(pageName);

    if (!(elementKey in properties)) {
      throw new Error(
        `Element key "${elementKey}" not found in ${pageName}.properties.\n` +
          `Available keys: ${Object.keys(properties).join(', ')}`
      );
    }

    const locator = properties[elementKey];
    Logger.debug(`Resolved "${reference}" → "${locator}"`);
    return locator;
  }

  public static loadPage(pageName: string): Record<string, string> {
    if (this.cache.has(pageName)) {
      return this.cache.get(pageName)!;
    }

    const filePath = path.join(this.PROPERTIES_DIR, `${pageName}.properties`);

    if (!fs.existsSync(filePath)) {
      const available = this.listAvailablePages();
      throw new Error(
        `Properties file not found: ${filePath}\n` +
          `Available pages: ${available.join(', ')}`
      );
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const properties = this.parse(content);
    this.cache.set(pageName, properties);
    return properties;
  }

  private static parse(content: string): Record<string, string> {
    const result: Record<string, string> = {};
    const lines = content.split(/\r?\n/);

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const eqIndex = line.indexOf('=');
      if (eqIndex === -1) continue;

      const key = line.substring(0, eqIndex).trim();
      const value = line.substring(eqIndex + 1).trim();

      if (key) {
        result[key] = value;
      }
    }

    return result;
  }

  public static listAvailablePages(): string[] {
    if (!fs.existsSync(this.PROPERTIES_DIR)) return [];
    return fs
      .readdirSync(this.PROPERTIES_DIR)
      .filter((f) => f.endsWith('.properties'))
      .map((f) => f.replace('.properties', ''));
  }

  public static clearCache(): void {
    this.cache.clear();
  }
}
