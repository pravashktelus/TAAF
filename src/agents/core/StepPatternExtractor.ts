import * as fs from 'fs';
import * as path from 'path';

/**
 * StepPatternExtractor
 * --------------------
 * Reads actual step definition files (WebSteps.ts, ApiSteps.ts, CommonSteps.ts, AdvancedSteps.ts)
 * and extracts the regex patterns into human-readable step patterns.
 *
 * This ensures the AI generates ONLY steps that are actually implemented in the framework.
 */
export class StepPatternExtractor {
  private static stepsDir = path.resolve(process.cwd(), 'src', 'steps');

  /**
   * Extracts all step patterns from Web step files.
   * Returns formatted list for AI prompt context.
   */
  static getWebStepPatterns(): string {
    const patterns: string[] = [];
    const files = ['WebSteps.ts', 'CommonSteps.ts', 'AdvancedSteps.ts'];

    for (const file of files) {
      const filePath = path.join(this.stepsDir, file);
      if (!fs.existsSync(filePath)) continue;
      const extracted = this._extractFromFile(filePath);
      if (extracted.length > 0) {
        patterns.push(`# From ${file}:`);
        patterns.push(...extracted);
        patterns.push('');
      }
    }

    return patterns.join('\n');
  }

  /**
   * Extracts all step patterns from API step files.
   * Returns formatted list for AI prompt context.
   */
  static getApiStepPatterns(): string {
    const patterns: string[] = [];
    const files = ['ApiSteps.ts', 'CommonSteps.ts'];

    for (const file of files) {
      const filePath = path.join(this.stepsDir, file);
      if (!fs.existsSync(filePath)) continue;
      const extracted = this._extractFromFile(filePath);
      if (extracted.length > 0) {
        patterns.push(`# From ${file}:`);
        patterns.push(...extracted);
        patterns.push('');
      }
    }

    return patterns.join('\n');
  }

  /**
   * Extracts step patterns from a single file.
   * Parses Given/When/Then regex patterns and converts to readable format.
   */
  private static _extractFromFile(filePath: string): string[] {
    const content = fs.readFileSync(filePath, 'utf-8');
    const patterns: string[] = [];

    // Match: Given(/^pattern$/,  or  When(/^pattern$/,  or  Then(/^pattern$/,
    // Also match: Given(\n  /^pattern$/,
    const stepRegex = /(Given|When|Then)\(\s*\/\^(.*?)\$\//g;
    let match;

    while ((match = stepRegex.exec(content)) !== null) {
      const keyword = match[1];
      let pattern = match[2];

      // Convert regex to readable format
      pattern = pattern
        .replace(/\(\?:([^)]+)\)/g, '$1')     // (?:text) → text
        .replace(/\(\\d\+\)/g, '<number>')      // (\d+) → <number>
        .replace(/\(\[\\s\\S\]\*\?\)/g, '<multiline>') // ([\s\S]*?) → <multiline>
        .replace(/\(\['\"\]\)/g, "'")           // (['\"]) → '
        .replace(/\['\"\]/g, "'")               // ['"] → '
        .replace(/\(\.\+\)/g, "'<value>'")      // (.+) → '<value>'
        .replace(/\(\.\*\)/g, "'<value>'")      // (.*) → '<value>'
        .replace(/\(\[\\^'\"\]\+\)/g, "'<value>'") // ([^'"]+) → '<value>'
        .replace(/\(\[\\^'\\\"'\]\+\)/g, "'<value>'")
        .replace(/\\s\+/g, ' ')                 // \s+ → space
        .replace(/\\s\*/g, ' ')                 // \s* → space
        .replace(/\\\//g, '/')                  // \/ → /
        .replace(/\\\./g, '.')                  // \. → .
        .replace(/\?/g, '')                     // remove optional markers
        .replace(/\s{2,}/g, ' ')                // collapse multiple spaces
        .trim();

      if (pattern && pattern.length > 5 && pattern.length < 150) {
        patterns.push(`- ${keyword} ${pattern}`);
      }
    }

    return patterns;
  }
}
