import * as fs from 'fs';
import * as path from 'path';

/**
 * ContextEnricher
 * ---------------
 * Reads existing framework artifacts (feature files, properties files)
 * and provides them as context to AI prompts in both Planner and Generator.
 *
 * This makes AI output match YOUR app's exact patterns — not generic ones.
 *
 * Scalable: reads from the actual framework folders — automatically picks up
 * any new feature files or properties files added in future.
 *
 * Used by: PlanPrompts.ts, GeneratePrompts.ts
 */
export class ContextEnricher {
  private static featuresDir = path.resolve(process.cwd(), 'features', 'web');
  private static propertiesDir = path.resolve(process.cwd(), 'src', 'pages', 'properties');

  // Max chars per file to include in prompt (keeps token usage reasonable)
  private static readonly MAX_FEATURE_CHARS = 2000;
  private static readonly MAX_PROPS_CHARS = 1500;
  private static readonly MAX_FILES = 3; // max feature files to include

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Returns existing feature file content as AI context.
   * Picks the most relevant files based on page name similarity.
   * Falls back to any available files if no match found.
   *
   * @param pageName - Current page being processed (e.g. "Support")
   */
  static getFeatureContext(pageName: string): string {
    const files = this._getFeatureFiles(pageName);
    if (files.length === 0) return '';

    const sections: string[] = [];
    sections.push('## Reference: Existing Feature File Patterns (follow these exactly)');
    sections.push('Use these as reference for tags, step patterns, element refs, and structure:\n');

    files.forEach((filePath) => {
      const content = fs.readFileSync(filePath, 'utf-8');
      const fileName = path.basename(filePath);
      sections.push(`### From ${fileName}:`);
      sections.push('```gherkin');
      sections.push(content.substring(0, this.MAX_FEATURE_CHARS));
      if (content.length > this.MAX_FEATURE_CHARS) sections.push('... (truncated)');
      sections.push('```\n');
    });

    return sections.join('\n');
  }

  /**
   * Returns existing properties file content as AI context.
   * Picks the most relevant files based on page name similarity.
   *
   * @param pageName - Current page being processed (e.g. "Support")
   */
  static getPropertiesContext(pageName: string): string {
    const files = this._getPropertiesFiles(pageName);
    if (files.length === 0) return '';

    const sections: string[] = [];
    sections.push('## Reference: Existing Properties File Patterns (follow naming conventions)');
    sections.push('Use these to understand element key naming, locator formats, and page structure:\n');

    files.forEach((filePath) => {
      const content = fs.readFileSync(filePath, 'utf-8');
      const fileName = path.basename(filePath);
      sections.push(`### From ${fileName}:`);
      sections.push('```properties');
      sections.push(content.substring(0, this.MAX_PROPS_CHARS));
      if (content.length > this.MAX_PROPS_CHARS) sections.push('... (truncated)');
      sections.push('```\n');
    });

    return sections.join('\n');
  }

  /**
   * Returns combined context (features + properties) for AI prompts.
   * Single call for convenience.
   *
   * @param pageName - Current page being processed
   */
  static getFullContext(pageName: string): string {
    const featureCtx = this.getFeatureContext(pageName);
    const propsCtx = this.getPropertiesContext(pageName);

    if (!featureCtx && !propsCtx) return '';

    const parts: string[] = [];
    parts.push('\n─── FRAMEWORK CONTEXT (use as reference) ───────────────────────────');
    if (featureCtx) parts.push(featureCtx);
    if (propsCtx) parts.push(propsCtx);
    parts.push('─────────────────────────────────────────────────────────────────────\n');

    return parts.join('\n');
  }

  // ─── Private: File Selection ──────────────────────────────────────────────

  private static _getFeatureFiles(pageName: string): string[] {
    if (!fs.existsSync(this.featuresDir)) return [];

    const allFiles = fs.readdirSync(this.featuresDir)
      .filter((f) => f.endsWith('.feature'))
      .map((f) => path.join(this.featuresDir, f));

    if (allFiles.length === 0) return [];

    // Sort by relevance — files whose name matches pageName come first
    const pageLower = pageName.toLowerCase();
    const sorted = allFiles.sort((a, b) => {
      const aName = path.basename(a).toLowerCase();
      const bName = path.basename(b).toLowerCase();
      const aMatch = aName.includes(pageLower) ? 0 : 1;
      const bMatch = bName.includes(pageLower) ? 0 : 1;
      return aMatch - bMatch;
    });

    // Return top N files (most relevant first)
    return sorted.slice(0, this.MAX_FILES);
  }

  private static _getPropertiesFiles(pageName: string): string[] {
    if (!fs.existsSync(this.propertiesDir)) return [];

    const allFiles = fs.readdirSync(this.propertiesDir)
      .filter((f) => f.endsWith('.properties'))
      .map((f) => path.join(this.propertiesDir, f));

    if (allFiles.length === 0) return [];

    const pageLower = pageName.toLowerCase();

    // Priority order:
    // 1. Exact page name match (e.g. CustomerSupport.properties for "Support")
    // 2. Fuzzy match (page name contains or is contained by file name)
    // 3. Any 2 files as fallback reference
    const sorted = allFiles.sort((a, b) => {
      const aName = path.basename(a, '.properties').toLowerCase();
      const bName = path.basename(b, '.properties').toLowerCase();

      const aExact = aName === pageLower ? 0 : aName.includes(pageLower) || pageLower.includes(aName) ? 1 : 2;
      const bExact = bName === pageLower ? 0 : bName.includes(pageLower) || pageLower.includes(bName) ? 1 : 2;

      return aExact - bExact;
    });

    // Return top 2 most relevant properties files
    return sorted.slice(0, 2);
  }
}
