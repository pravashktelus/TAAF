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
   * Returns combined context (features + properties + knowledge bank) for AI prompts.
   * Single call for convenience.
   *
   * @param pageName - Current page being processed
   */
  static getFullContext(pageName: string, relevanceHint?: string): string {
    const featureCtx = this.getFeatureContext(pageName);
    const propsCtx = this.getPropertiesContext(pageName);
    // Relevance hint drives selective domain-knowledge loading. Default to the
    // page name; callers may pass a richer hint (page + story title + URL).
    const knowledgeCtx = this.getKnowledgeBankContext(relevanceHint || pageName);

    if (!featureCtx && !propsCtx && !knowledgeCtx) return '';

    const parts: string[] = [];
    parts.push('\n─── FRAMEWORK CONTEXT (use as reference) ───────────────────────────');
    if (knowledgeCtx) parts.push(knowledgeCtx);
    if (featureCtx) parts.push(featureCtx);
    if (propsCtx) parts.push(propsCtx);
    parts.push('─────────────────────────────────────────────────────────────────────\n');

    return parts.join('\n');
  }

  // Root directory of the knowledge bank. New subfolders/files added here are
  // auto-discovered — NO code change needed to introduce new knowledge.
  private static knowledgeDir = path.resolve(__dirname, '../knowledge');

  // Max chars per knowledge file included in a prompt (keeps token usage reasonable).
  // Knowledge files are kept focused (one topic per file); 4500 comfortably fits a
  // full focused file so its tail (often the quick-reference tables) isn't truncated.
  private static readonly MAX_KNOWLEDGE_CHARS = 4500;

  /**
   * Recursively finds all .md files under the knowledge/ directory (any depth).
   * Returns absolute file paths sorted for stable, deterministic ordering.
   */
  private static _findKnowledgeFiles(dir: string = this.knowledgeDir): string[] {
    if (!fs.existsSync(dir)) return [];

    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this._findKnowledgeFiles(fullPath)); // recurse into subfolders
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }
    // Sort by relative path so ordering is stable (domain/ before patterns/ before templates/)
    return results.sort();
  }

  /**
   * Loads ONLY the API patterns knowledge file — for API test generation prompts.
   * Located by filename ('api-patterns.md') regardless of which subfolder it lives in.
   */
  static getApiKnowledge(): string {
    const files = this._findKnowledgeFiles();
    const apiFile = files.find((f) => path.basename(f) === 'api-patterns.md');
    if (!apiFile) return '';
    return fs.readFileSync(apiFile, 'utf-8');
  }

  /**
   * Loads ALL knowledge bank files from src/agents/knowledge/ (recursively, any subfolder).
   * Auto-discovers new files/folders — adding knowledge requires NO code change.
   * Files are grouped by their subfolder (domain/patterns/templates) with a header.
   */
  static getKnowledgeBankContext(relevanceHint?: string): string {
    const files = this._findKnowledgeFiles();
    if (files.length === 0) return '';

    const hint = (relevanceHint || '').toLowerCase();
    const sections: string[] = [];
    let lastFolder = '';

    for (const filePath of files) {
      const relative = path.relative(this.knowledgeDir, filePath);
      const folder = path.dirname(relative);

      // ── Selective domain knowledge ──────────────────────────────────────
      // Files nested inside a domain SUBFOLDER (e.g. "domain/Telecom domain/…")
      // are domain-specific. Only include them when the current story/page is
      // relevant, so a telecom knowledge file never pollutes a banking or
      // generic story. Top-level files (domain/, patterns/, templates/) are
      // always included. Adding a new domain folder needs NO code change —
      // just declare `triggers:` in the file's frontmatter.
      const isNestedDomainFile = folder.toLowerCase().startsWith('domain' + path.sep + '')
        && folder.toLowerCase() !== 'domain';

      const content = fs.readFileSync(filePath, 'utf-8');

      if (isNestedDomainFile) {
        const triggers = this._extractTriggers(content, folder);
        const matched = triggers.some((t) => hint.includes(t));
        if (!matched) {
          // Not relevant to this story/page — skip this domain file.
          continue;
        }
      }

      if (folder !== '.' && folder !== lastFolder) {
        sections.push(`\n### KNOWLEDGE: ${folder.toUpperCase()} ###`);
        lastFolder = folder;
      }

      const truncated = content.length > this.MAX_KNOWLEDGE_CHARS
        ? content.substring(0, this.MAX_KNOWLEDGE_CHARS) + '\n... (truncated)'
        : content;
      sections.push(truncated);
      sections.push('');
    }

    return sections.join('\n');
  }

  /**
   * Extracts trigger keywords that decide whether a domain-specific knowledge
   * file is relevant to the current story/page.
   *
   * Priority:
   *   1. A `triggers:` line in the file (e.g. "<!-- triggers: telecom, broadband, teleconnect -->"
   *      or a Markdown line "triggers: telecom, broadband").
   *   2. Fallback: tokens derived from the containing folder name
   *      (e.g. "Telecom domain" → ["telecom"]).
   *
   * All keywords are lowercased. This keeps adding new domains zero-code:
   * drop a file with a `triggers:` line into a new domain subfolder.
   */
  private static _extractTriggers(content: string, folder: string): string[] {
    // Capture the triggers value up to end-of-line, then strip a trailing HTML
    // comment close (`-->`). This preserves hyphenated triggers like "e-commerce"
    // (a previous regex that excluded '-' truncated the list and left a stray "e"
    // that matched almost any hint).
    const match = content.match(/triggers\s*:\s*(.+)/i);
    if (match) {
      const raw = match[1].replace(/--+>\s*$/, '').trim();
      return raw
        .split(',')
        .map((t) => t.trim().toLowerCase())
        // Ignore empty and 1-char tokens (too broad, cause false matches)
        .filter((t) => t.length >= 2);
    }
    // Fallback: folder-name tokens (drop the generic word "domain")
    const leaf = folder.split(path.sep).pop() || folder;
    return leaf
      .toLowerCase()
      .split(/[\s_-]+/)
      .filter((t) => t && t !== 'domain');
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
