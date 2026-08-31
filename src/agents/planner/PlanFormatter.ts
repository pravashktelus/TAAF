import * as fs from 'fs';
import * as path from 'path';
import { AgentsConfig } from '../config/AgentsConfig';

// ─── Credential Detection & Masking ─────────────────────────────────────────

/**
 * Detects if a value is a credential (email, password, token).
 */
function _isCredential(value: string): boolean {
  if (!value || value.length < 4) return false;
  // Looks like an email
  if (value.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return true;
  // Looks like a password (mixed case + number/special, 6+ chars)
  if (value.length >= 6 && value.match(/[A-Z]/) && value.match(/[a-z]/) && value.match(/[0-9!@#$%^&*]/)) return true;
  // Looks like a token/key (long alphanumeric)
  if (value.length > 20 && value.match(/^[A-Za-z0-9_\-]+$/)) return true;
  return false;
}

/**
 * Masks a credential for display: first 2 chars + *****
 */
function _mask(value: string): string {
  if (!value || value.length <= 2) return '*****';
  return value.substring(0, 2) + '*****';
}

/**
 * Represents a parsed test case from AI response.
 */
export interface PlanTestCase {
  id: string;
  title: string;
  type: string;
  navigation: string;
  steps: {
    stepNo: number;
    action: string;
    navigation: string;
    testData: string;
    expected: string;
  }[];
  edgeCases: string[];
}

/**
 * Represents the full structured plan (written to .json and .md).
 */
export interface TestPlan {
  page: string;
  url: string;
  mode: string;
  aiGenerated: boolean;
  generatedAt: string;
  sourceFile: string;
  elements: any[];
  testCases: PlanTestCase[];
}

/**
 * PlanFormatter
 * -------------
 * Receives raw AI response (JSON string), parses it,
 * and writes two output files:
 *   - generated/plans/{Page}-plan.json  (machine-readable, for Generator)
 *   - generated/plans/{Page}-plan.md    (human-readable, for QA review)
 */
export class PlanFormatter {
  private config: AgentsConfig;
  private outputDir: string;

  constructor() {
    this.config = AgentsConfig.getInstance();
    this.outputDir = path.resolve(process.cwd(), this.config.outputDir, 'plans');
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Parses AI response, enriches with metadata, writes both output files.
   *
   * @param aiResponse  - Raw JSON string from LLMClient (or fallback template)
   * @param pageName    - Target page name
   * @param sourceFile  - Original input file name
   * @returns           - Paths to generated .md and .json files
   */
  format(
    aiResponse: string,
    pageName: string,
    sourceFile: string,
    analysis?: { detected: string[]; assumptions: string[]; warnings: string[]; dependencies: string[] }
  ): { mdPath: string; jsonPath: string } {
    this._ensureOutputDir();

    // Parse AI response
    const plan = this._parseResponse(aiResponse, pageName, sourceFile);

    // Attach analysis metadata to the plan
    if (analysis) {
      (plan as any).analysis = analysis;
    }

    // Write files
    const jsonPath = this._writeJson(plan, pageName, sourceFile);
    const mdPath = this._writeMarkdown(plan, pageName, sourceFile);

    return { mdPath, jsonPath };
  }

  // ─── Private: Parse ───────────────────────────────────────────────────────

  private _parseResponse(raw: string, pageName: string, sourceFile: string): TestPlan {
    let parsed: any = {};

    try {
      // Strip markdown code fences if AI wrapped JSON in ```json ... ```
      const cleaned = raw
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

      parsed = JSON.parse(cleaned);
    } catch {
      console.warn('[PlanFormatter] Could not parse AI response as JSON. Using raw content as note.');
      parsed = {
        page: pageName,
        url: '',
        mode: 'unknown',
        aiGenerated: false,
        elements: [],
        testCases: [],
        note: raw.substring(0, 500),
      };
    }

    // Enrich with metadata
    const plan: TestPlan = {
      page: parsed.page || pageName,
      url: parsed.url || '',
      mode: parsed.mode || 'story',
      aiGenerated: parsed.aiGenerated !== false,
      generatedAt: new Date().toISOString(),
      sourceFile,
      elements: parsed.elements || [],
      testCases: this._normaliseTestCases(parsed.testCases || []),
    };

    return plan;
  }

  private _normaliseTestCases(raw: any[]): PlanTestCase[] {
    return raw.map((tc, index) => ({
      id: tc.id || `TC-${String(index + 1).padStart(3, '0')}`,
      title: tc.title || 'Untitled Test Case',
      type: tc.type || 'happy_path',
      navigation: tc.navigation || '',
      steps: (tc.steps || []).map((s: any, si: number) => {
        const action = s.action || '';
        const actionLower = action.toLowerCase();
        // Infer expected result if empty
        let expected = s.expected || '';
        if (!expected) {
          // ── API-specific expected results ──
          if (actionLower.includes('set the base url') || actionLower.includes('set base url')) {
            expected = 'Base URL is set';
          } else if (actionLower.includes('set bearer token') || actionLower.includes('set api key')) {
            expected = 'Auth header is set';
          } else if (actionLower.match(/send a get request/)) {
            expected = 'GET request is sent and response received';
          } else if (actionLower.match(/send a post request/)) {
            expected = 'POST request is sent and resource created';
          } else if (actionLower.match(/send a put request|send a patch request/)) {
            expected = 'Request is sent and resource updated';
          } else if (actionLower.match(/send a delete request/)) {
            expected = 'DELETE request is sent and resource removed';
          } else if (actionLower.includes('response status')) {
            expected = action.replace(/^(?:verify:?\s*)/i, 'Response ');
          } else if (actionLower.includes('response body field') && actionLower.includes('should exist')) {
            const field = action.match(/field ['"]([^'"]+)['"]/i);
            expected = field ? `Field '${field[1]}' exists in response` : 'Field exists in response';
          } else if (actionLower.includes('response body field') && (actionLower.includes('should equal') || actionLower.includes('should be'))) {
            const field = action.match(/field ['"]([^'"]+)['"].*['"]([^'"]+)['"]/i);
            expected = field ? `Field '${field[1]}' equals '${field[2]}'` : 'Field matches expected value';
          } else if (actionLower.includes('store') && actionLower.includes('response')) {
            const varMatch = action.match(/as ['"]([^'"]+)['"]/i);
            expected = varMatch ? `Response value stored as '${varMatch[1]}'` : 'Response value stored';
          }
          // ── Web/generic expected results ──
          else if (actionLower.startsWith('verify') || actionLower.startsWith('confirm') || actionLower.startsWith('assert')) {
            expected = action.replace(/^(?:verify:?\s*|confirm:?\s*|assert:?\s*)/i, '').trim() || action;
          } else if (actionLower.startsWith('navigate') || actionLower.includes('navigate to') || actionLower.startsWith('open')) {
            expected = 'Page loaded successfully';
          } else if (actionLower.startsWith('click')) {
            const target = action.match(/["'"]([^"'"]+)["'"]/);
            expected = target ? `"${target[1]}" clicked successfully` : 'Element clicked successfully';
          } else if (actionLower.startsWith('enter') || actionLower.startsWith('type') || actionLower.startsWith('fill')) {
            const field = action.match(/(?:into|in)\s+(?:the\s+)?["'"]([^"'"]+)["'"]/i);
            expected = field ? `Value entered in "${field[1]}" field` : 'Value entered successfully';
          } else if (actionLower.startsWith('select')) {
            const opt = action.match(/select\s+["'"]?([^"'"]+)["'"]?\s+from/i);
            expected = opt ? `"${opt[1].trim()}" selected` : 'Option selected successfully';
          } else if (actionLower.startsWith('check')) {
            expected = 'Checkbox checked';
          } else {
            expected = 'Step completed successfully';
          }
        }
        return {
          stepNo: s.stepNo || si + 1,
          action,
          navigation: s.navigation || '',
          testData: s.testData || '',
          expected,
        };
      }),
      edgeCases: tc.edgeCases || [],
    }));
  }

  // ─── Private: Write JSON ──────────────────────────────────────────────────

  private _writeJson(plan: TestPlan, pageName: string, sourceFile: string): string {
    const sourceSuffix = this._buildSourceSuffix(sourceFile);
    const fileName = `${pageName}-plan${sourceSuffix}.json`;
    const filePath = path.join(this.outputDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(plan, null, 2), 'utf-8');
    console.log(`[PlanFormatter] JSON plan written: ${filePath}`);
    return filePath;
  }

  // ─── Private: Write Markdown ──────────────────────────────────────────────

  private _writeMarkdown(plan: TestPlan, pageName: string, sourceFile: string): string {
    const sourceSuffix = this._buildSourceSuffix(sourceFile);
    const fileName = `${pageName}-plan${sourceSuffix}.md`;
    const filePath = path.join(this.outputDir, fileName);
    const md = this._buildMarkdown(plan);
    fs.writeFileSync(filePath, md, 'utf-8');
    console.log(`[PlanFormatter] Markdown plan written: ${filePath}`);
    return filePath;
  }

  private _buildMarkdown(plan: TestPlan): string {
    const lines: string[] = [];

    // Header
    lines.push(`# Test Plan: ${plan.page} Page`);
    lines.push('');
    lines.push(`| Field | Value |`);
    lines.push(`|---|---|`);
    lines.push(`| Generated | ${new Date(plan.generatedAt).toLocaleString()} |`);
    lines.push(`| Source | ${plan.sourceFile} |`);
    lines.push(`| Mode | ${plan.mode} |`);
    lines.push(`| AI Generated | ${plan.aiGenerated ? 'Yes' : 'No (template)'} |`);
    if (plan.url) lines.push(`| URL | ${plan.url} |`);
    lines.push(`| Total Test Cases | ${plan.testCases.length} |`);
    lines.push('');

    // Analysis & Assumptions section
    const analysis = (plan as any).analysis;
    if (analysis) {
      lines.push('## Analysis & Assumptions');
      lines.push('');
      if (analysis.detected?.length > 0) {
        lines.push('**Detected:**');
        analysis.detected.forEach((d: string) => lines.push(`- ${d}`));
        lines.push('');
      }
      if (analysis.assumptions?.length > 0) {
        lines.push('**Assumptions:**');
        analysis.assumptions.forEach((a: string) => lines.push(`- ${a}`));
        lines.push('');
      }
      if (analysis.dependencies?.length > 0) {
        lines.push('**Dependencies:**');
        analysis.dependencies.forEach((d: string) => lines.push(`- ${d}`));
        lines.push('');
      }
      if (analysis.warnings?.length > 0) {
        lines.push('**⚠️ Warnings / Ambiguities:**');
        analysis.warnings.forEach((w: string) => lines.push(`- ${w}`));
        lines.push('');
      }
    }

    // Discovered elements summary
    if (plan.elements && plan.elements.length > 0) {
      lines.push('## Discovered Page Elements');
      lines.push('');
      lines.push('| Key | Type | Locator |');
      lines.push('|---|---|---|');
      plan.elements.forEach((el: any) => {
        lines.push(`| ${el.key || '-'} | ${el.type || '-'} | \`${el.locator || '-'}\` |`);
      });
      lines.push('');
    }

    // Test cases
    if (plan.testCases.length === 0) {
      lines.push('## Test Cases');
      lines.push('');
      lines.push('> No test cases generated. Check AI response or provide a valid story/test cases file.');
      lines.push('');
    } else {
      lines.push('## Test Cases');
      lines.push('');

      plan.testCases.forEach((tc) => {
        // Test case header
        lines.push(`### ${tc.id}: ${tc.title}`);
        lines.push('');
        lines.push(`**Type:** ${tc.type}`);
        if (tc.navigation) lines.push(`**Navigation:** ${tc.navigation}`);
        lines.push('');

        // Steps table
        if (tc.steps.length > 0) {
          lines.push('| Step | Action/Navigation | Test Data | Expected Result |');
          lines.push('|---|---|---|---|');
          tc.steps.forEach((s) => {
            const actionNav = [s.action, s.navigation].filter(Boolean).join(' → ');
            // Detect if this step interacts with a sensitive field
            const isSensitiveStep = /(?:password|passwd|username|user.?name|email|token|secret|credential|api.?key)/i.test(actionNav);

            let displayAction = actionNav || '-';
            let displayData = s.testData || '-';

            if (isSensitiveStep) {
              // Mask all quoted values in the action text that look like data (not field names)
              displayAction = actionNav.replace(
                /((?:enter|type)\s+)["'"]([^"'"]+)["'"]/gi,
                (match, prefix, val) => `${prefix}"${_mask(val)}"`
              );
              // Mask testData
              if (s.testData && s.testData !== '-') {
                displayData = _mask(s.testData);
              }
            } else if (s.testData && _isCredential(s.testData)) {
              displayData = _mask(s.testData);
            }

            lines.push(`| ${s.stepNo} | ${displayAction} | ${displayData} | ${s.expected || '-'} |`);
          });
          lines.push('');
        }

        // Edge cases
        if (tc.edgeCases && tc.edgeCases.length > 0) {
          lines.push('**Edge Cases:**');
          tc.edgeCases.forEach((ec) => lines.push(`- ${ec}`));
          lines.push('');
        }

        lines.push('---');
        lines.push('');
      });
    }

    // Footer
    lines.push('');
    lines.push(`> Generated by Planner Agent | Feed \`${plan.page}-plan.json\` to Generator Agent`);
    lines.push(`> \`npm run agent:generate -- --plan generated/plans/${plan.page}-plan.json\``);

    return lines.join('\n');
  }

  // ─── Private: Utilities ───────────────────────────────────────────────────

  private _buildSourceSuffix(sourceFile: string): string {
    if (!sourceFile || sourceFile === 'unknown') return '';
    // Extract filename without extension, sanitise for use in file name
    const baseName = path.basename(sourceFile, path.extname(sourceFile));
    const sanitised = baseName.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `_from_${sanitised}`;
  }

  private _ensureOutputDir(): void {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
      console.log(`[PlanFormatter] Created output directory: ${this.outputDir}`);
    }
  }
}
