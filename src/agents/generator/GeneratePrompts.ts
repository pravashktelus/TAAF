import { TestPlan, PlanTestCase } from '../planner/PlanFormatter';

/**
 * GeneratePrompts
 * ---------------
 * Builds AI prompts for the Generator agent.
 * Instructs AI to generate BDD feature files using:
 *   - Test cases from the plan
 *   - Your exact step definition vocabulary (from WebSteps.ts)
 *   - Your feature file conventions (tags, format, element references)
 *   - PropertiesRegistry element refs (PageName.ElementKey format)
 */
export class GeneratePrompts {

  // ─── System Prompt ────────────────────────────────────────────────────────

  static readonly SYSTEM_PROMPT = `You are a BDD automation expert who writes Gherkin feature files.
You ONLY use the exact step patterns provided — never invent new steps.
You use element references in 'PageName.ElementKey' format.
You follow the exact feature file conventions provided.
You output ONLY valid Gherkin — no markdown, no explanation, just the .feature file content.`;

  // ─── Available Step Patterns (extracted from WebSteps.ts) ─────────────────

  static readonly STEP_PATTERNS = `
## Available Step Patterns (use ONLY these):

### Navigation
Given I navigate to the application
Given I navigate to '<url>'
When I go back
When I refresh the page

### Interactions
When I click '<Page.Element>'
When I double click '<Page.Element>'
When I enter '<value>' into '<Page.Element>'
When I type '<value>' into '<Page.Element>'
When I select '<Option>' from '<Page.Element>'
When I select '<Option>' from dropdown '<Page.Element>'
When I check '<Page.Element>'
When I hover over '<Page.Element>'
When I scroll to '<Page.Element>'
When I wait <N> seconds
When I wait for '<Page.Element>' to be visible

### Data & Variables
When I get text from '<Page.Element>' and store as '<varName>'
When I store text of '<Page.Element>' as '<varName>'
When I persist '<{varName}>' as '<varName>'
When I store attribute '<attr>' of '<Page.Element>' as '<varName>'

### Assertions
Then '<Page.Element>' should be visible
Then '<Page.Element>' should be hidden
Then '<Page.Element>' should have text '<expected>'
Then '<Page.Element>' should contain text '<partial>'
Then '<Page.Element>' should have value '<expected>'
Then '<Page.Element>' should be enabled
Then '<Page.Element>' should be disabled
Then '<Page.Element>' should have color '<red|green|blue|orange>'
Then the url should contain '<fragment>'
Then the page title should be '<title>'

### Report
Then I attach '<varName>' to the report as '<Label>'

## Data Syntax
- Random data: ##FullName, ##Email, ##MobileNum, ##Password, ##Address, ##PhoneNum
- Scenario variables: {variableName}  (set earlier in same scenario)
- Cross-scenario variables: $$variableName  (persisted across scenarios)

## Element Reference Format
Always use: 'PageName.ElementKey'
Example: 'CustomerSupport.BtnSubmit', 'TeleConnect.LoginEmail'
`;

  // ─── Feature File Conventions ─────────────────────────────────────────────

  static readonly CONVENTIONS = `
## Feature File Conventions

### Tags
- Web scenarios: @web @<modulename>_web (e.g. @web @support_web)
- Add @smoke for critical path
- Add @e2e for end-to-end flows
- Add @negative for validation/error scenarios
- Add @regression for full suite

### Structure
@web @<module>_web
Feature: <PageName> - <Short Description>
  As a <role>
  I want to <goal>

  @smoke @e2e
  Scenario: TC-001 <Title>
    Given I navigate to the application
    # ═══ <SECTION NAME> ═══
    When I click '<Page.Element>'
    Then '<Page.Element>' should be visible

### Rules
- Use comment headers (# ═══ SECTION ═══) to group related steps
- One scenario per test case from the plan
- Keep scenarios focused on one flow
- Use Background only when 3+ scenarios share same setup steps
- For cross-scenario data use $$variableName (e.g. $$Email, $$Password)
`;

  // ─── Main Prompt Builder ──────────────────────────────────────────────────

  /**
   * Builds the full prompt for feature file generation.
   *
   * @param plan         - Full test plan from Planner
   * @param elementRefs  - Map of element key → PageName.ElementKey ref
   * @param frameworkContext - Existing feature/properties context from ContextEnricher
   */
  static buildPrompt(
    plan: TestPlan,
    elementRefs: Map<string, string>,
    frameworkContext: string = ''
  ): string {
    const sections: string[] = [];

    // Framework context first — AI reads existing patterns before generating
    if (frameworkContext) sections.push(frameworkContext);

    // Available steps + conventions
    sections.push(this.STEP_PATTERNS);
    sections.push(this.CONVENTIONS);

    // Element references — CRITICAL section
    sections.push('\n## CRITICAL: Available Element References');
    sections.push('You MUST use ONLY these exact element references. NEVER invent page names like LoginPage, OrdersPage, SupportPage.');
    sections.push('NEVER use Support.ElementKey as a placeholder — use the REAL refs listed below.');
    sections.push(`For any element genuinely NOT listed here, use '${plan.page}.ElementKey' — the locator will need to be added to .properties separately.\n`);

    if (elementRefs.size > 0) {
      // Group by page name for clarity
      const byPage = new Map<string, string[]>();
      elementRefs.forEach((ref) => {
        const pageName = ref.split('.')[0];
        if (!byPage.has(pageName)) byPage.set(pageName, []);
        byPage.get(pageName)!.push(ref);
      });

      byPage.forEach((refs, pageName) => {
        sections.push(`### ${pageName}.properties — USE THESE DIRECTLY:`);
        refs.slice(0, 20).forEach((ref) => sections.push(`  ${ref}`)); // cap at 20 per page
        if (refs.length > 20) sections.push(`  ... and ${refs.length - 20} more`);
        sections.push('');
      });

      // Explicit instruction on how to use them
      sections.push(`## How to use existing refs:`);
      sections.push(`- Login steps → use CustomerSupport.SigninEmail, CustomerSupport.SigninPassword, CustomerSupport.BtnSignIn`);
      sections.push(`- Navigation → use CustomerSupport.NavOrders, CustomerSupport.BtnViewDetails etc.`);
      sections.push(`- New elements not in list → use '${plan.page}.ElementKey' (must exist in .properties file)`);
    } else {
      sections.push(`  WARNING: No existing elements found. Use '${plan.page}.ElementKey' refs — locators must be added to .properties via Playwright MCP or --url crawl.`);
    }

    // Explicit page naming rule
    const knownPages = [...new Set([...elementRefs.values()].map((r) => r.split('.')[0]))];
    sections.push(`\n## Page Name Rule`);
    sections.push(`Current page: "${plan.page}"`);
    sections.push(`Existing property pages: ${knownPages.join(', ') || 'none'}`);
    sections.push(`PREFER existing page refs over creating new ones.`);
    sections.push(`Only use '${plan.page}.*' for elements specific to the new dialog/form not covered by existing pages.\n`);

    // Test cases to convert
    sections.push(`## Test Cases to Convert`);
    sections.push(`Page: ${plan.page}`);
    sections.push(`Source: ${plan.sourceFile}`);
    sections.push(`Total: ${plan.testCases.length} test case(s)\n`);

    plan.testCases.forEach((tc) => {
      sections.push(this._formatTestCase(tc));
    });

    // Final instruction
    sections.push(`
## Your Task
Convert ALL ${plan.testCases.length} test cases above into a single .feature file.
- Use ONLY the step patterns listed above — do not invent new step patterns
- Use ONLY element references from the "Available Element References" section above
- For missing elements: use '${plan.page}.ElementKey' format (locator will be added to .properties separately)
- NEVER append # TODO comments to step lines — they break Cucumber regex matching
- Follow the feature file conventions exactly
- Add comment headers (# ═══ SECTION ═══) to group steps
- Output ONLY the .feature file content — no explanation, no markdown fences`);

    return sections.join('\n');
  }

  // ─── Fallback Template ────────────────────────────────────────────────────

  /**
   * Deterministic feature file builder — produces a complete .feature file
   * directly from the plan JSON using rule-based step mapping.
   * Used as fallback when AI is unavailable, AND as the primary builder (P3 fix).
   *
   * The AI prompt (buildPrompt) is now used only to REFINE individual ambiguous steps,
   * not to generate the entire feature file from scratch.
   */
  static buildFallback(plan: TestPlan, elementRefs: Map<string, string>): string {
    const moduleName = plan.page.toLowerCase();
    const lines: string[] = [];

    lines.push(`@web @${moduleName}_web`);
    lines.push(`Feature: ${plan.page} - ${plan.sourceFile?.replace(/\.[^.]+$/, '') || 'Generated Feature'}`);
    lines.push(`  As a user`);
    lines.push(`  I want to interact with the ${plan.page} page`);
    lines.push('');

    plan.testCases.forEach((tc) => {
      const tags = this._getTags(tc.type);
      lines.push(`  ${tags}`);
      lines.push(`  Scenario: ${tc.id} ${tc.title}`);
      lines.push(`    Given I navigate to the application`);

      tc.steps.forEach((s) => {
        const automationSteps = this._mapStepToGherkin(s, plan.page, elementRefs);
        automationSteps.forEach((step) => lines.push(`    ${step}`));
      });

      lines.push('');
    });

    return lines.join('\n');
  }

  // ─── Deterministic Step Mapper ────────────────────────────────────────────

  /**
   * Maps a single plan step (action + testData + expected) into one or more
   * Gherkin steps using rule-based pattern matching.
   *
   * This is the core P3 fix: instead of asking AI to generate the whole feature,
   * we map each step deterministically and only flag truly ambiguous ones.
   */
  private static _mapStepToGherkin(
    step: { stepNo: number; action: string; navigation: string; testData: string; expected: string },
    pageName: string,
    elementRefs: Map<string, string>
  ): string[] {
    const results: string[] = [];
    const action = step.action.toLowerCase();
    const expected = step.expected.toLowerCase();

    // Add section comment for readability
    results.push(`# ═══ Step ${step.stepNo}: ${step.action.substring(0, 60)} ═══`);

    // ─── Pattern: Navigate / Open ───────────────────────────────────────
    if (action.includes('navigate') || action.includes('open') || action.includes('go to')) {
      // If step mentions a specific URL
      const urlMatch = step.action.match(/https?:\/\/[^\s'"]+/) || step.testData.match(/https?:\/\/[^\s'"]+/);
      if (urlMatch) {
        results.push(`Given I navigate to '${urlMatch[0]}'`);
      }
      // If navigating via a nav link element
      const navRef = this._findElementRef(step.action, pageName, elementRefs, 'nav');
      if (navRef && !urlMatch) {
        results.push(`When I click '${navRef}'`);
      }
    }

    // ─── Pattern: Click ─────────────────────────────────────────────────
    else if (action.includes('click')) {
      const ref = this._findElementRef(step.action, pageName, elementRefs, 'btn');
      if (ref) {
        results.push(`When I click '${ref}'`);
      } else {
        results.push(`# ACTION: ${step.action}`);
        results.push(`When I click '${pageName}.${this._suggestKey(step.action, 'Btn')}'`);
      }
    }

    // ─── Pattern: Enter / Type / Fill ───────────────────────────────────
    else if (action.includes('enter') || action.includes('type') || action.includes('fill') || action.includes('input')) {
      const ref = this._findElementRef(step.action, pageName, elementRefs, 'input');
      const value = this._extractValue(step);
      if (ref) {
        results.push(`When I enter '${value}' into '${ref}'`);
      } else {
        results.push(`# ACTION: ${step.action}`);
        results.push(`When I enter '${value}' into '${pageName}.${this._suggestKey(step.action, 'Input')}'`);
      }
    }

    // ─── Pattern: Select / Dropdown ─────────────────────────────────────
    else if (action.includes('select') || action.includes('dropdown') || action.includes('choose')) {
      const ref = this._findElementRef(step.action, pageName, elementRefs, 'select');
      const value = this._extractValue(step);
      if (ref) {
        results.push(`When I select '${value}' from dropdown '${ref}'`);
      } else {
        results.push(`# ACTION: ${step.action}`);
        results.push(`When I select '${value}' from dropdown '${pageName}.${this._suggestKey(step.action, 'Select')}'`);
      }
    }

    // ─── Pattern: Verify / Assert / Check ───────────────────────────────
    else if (action.includes('verify') || action.includes('validate') || action.includes('check') || action.includes('assert') || action.includes('should')) {
      const verifySteps = this._buildVerifySteps(step, pageName, elementRefs);
      results.push(...verifySteps);
    }

    // ─── Pattern: Store / Capture ───────────────────────────────────────
    else if (action.includes('capture') || action.includes('store') || action.includes('get text') || action.includes('save')) {
      const ref = this._findElementRef(step.action, pageName, elementRefs);
      const varName = this._extractVarName(step.action);
      if (ref) {
        results.push(`When I get text from '${ref}' and store as '${varName}'`);
        results.push(`Then I attach '${varName}' to the report as '${varName}'`);
      } else {
        results.push(`# ACTION: ${step.action}`);
        results.push(`When I get text from '${pageName}.${this._suggestKey(step.action, '')}' and store as '${varName}'`);
      }
    }

    // ─── Pattern: Wait ──────────────────────────────────────────────────
    else if (action.includes('wait')) {
      const seconds = action.match(/(\d+)/)?.[1] || '2';
      results.push(`When I wait ${seconds} seconds`);
    }

    // ─── Pattern: Scroll ────────────────────────────────────────────────
    else if (action.includes('scroll')) {
      const ref = this._findElementRef(step.action, pageName, elementRefs);
      if (ref) {
        results.push(`When I scroll to '${ref}'`);
      } else {
        results.push(`# ACTION: ${step.action} — scroll target not mapped`);
      }
    }

    // ─── Fallback: Unrecognized action ──────────────────────────────────
    else {
      results.push(`# ACTION: ${step.action}`);
      // Try to infer from expected result
      if (step.expected) {
        const verifySteps = this._buildVerifySteps(step, pageName, elementRefs);
        if (verifySteps.length > 0) results.push(...verifySteps);
      }
    }

    // ─── Add expected result assertions if not already covered ───────────
    if (step.expected && !action.includes('verify') && !action.includes('validate') && !action.includes('check')) {
      const expectedSteps = this._buildExpectedAssertions(step.expected, pageName, elementRefs);
      results.push(...expectedSteps);
    }

    return results;
  }

  // ─── Step Mapping Helpers ─────────────────────────────────────────────────

  /**
   * Finds the best matching element ref from available refs for a given action text.
   */
  private static _findElementRef(
    actionText: string,
    pageName: string,
    elementRefs: Map<string, string>,
    preferType?: string
  ): string | null {
    const actionLower = actionText.toLowerCase();

    // Extract keywords from action (strip common verbs)
    const keywords = actionLower
      .replace(/\b(click|enter|type|fill|select|verify|navigate|check|on|the|a|an|in|to|from|into|should|be|is|are|i|and|then|when|given)\b/g, '')
      .split(/[\s'"""''.,;:]+/)
      .filter((w) => w.length > 2);

    let bestMatch: string | null = null;
    let bestScore = 0;

    elementRefs.forEach((ref) => {
      const refLower = ref.toLowerCase();
      let score = 0;

      keywords.forEach((kw) => {
        if (refLower.includes(kw)) score += 2;
      });

      // Bonus for matching type prefix
      if (preferType) {
        if (preferType === 'btn' && refLower.includes('btn')) score += 1;
        if (preferType === 'input' && (refLower.includes('input') || refLower.includes('email') || refLower.includes('password') || refLower.includes('name'))) score += 1;
        if (preferType === 'nav' && refLower.includes('nav')) score += 1;
        if (preferType === 'select' && refLower.includes('select')) score += 1;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = ref;
      }
    });

    return bestScore >= 2 ? bestMatch : null;
  }

  /**
   * Extracts the data value to use in a step from testData or action text.
   */
  private static _extractValue(step: { action: string; testData: string }): string {
    // Check testData first
    if (step.testData) {
      // If it's a JSON-like object, try to extract the first value
      const kvMatch = step.testData.match(/['"]([^'"]+)['"]\s*[:,]\s*['"]([^'"]+)['"]/);
      if (kvMatch) return kvMatch[2];

      // If it's a simple variable reference
      if (step.testData.startsWith('$$') || step.testData.startsWith('{') || step.testData.startsWith('##')) {
        return step.testData;
      }

      return step.testData;
    }

    // Try to extract quoted value from action
    const quoted = step.action.match(/['"""''']([^'"""''']+)['"""''']/);
    if (quoted) return quoted[1];

    // Use random data placeholder
    return '##Value';
  }

  /**
   * Extracts a variable name from action text for store operations.
   */
  private static _extractVarName(action: string): string {
    // Look for known patterns: "store as X", "capture X"
    const storeMatch = action.match(/(?:store|save|capture)\s+(?:as\s+)?['"]?(\w+)['"]?/i);
    if (storeMatch) return storeMatch[1];

    // Extract the noun from the action
    const words = action.replace(/\b(capture|store|get|text|from|and|show|in|the|report)\b/gi, '')
      .trim().split(/\s+/).filter((w) => w.length > 2);
    return words.length > 0 ? words.join('') : 'CapturedValue';
  }

  /**
   * Suggests a PascalCase element key from action text.
   */
  private static _suggestKey(action: string, prefix: string): string {
    const words = action
      .replace(/\b(click|enter|type|fill|select|verify|navigate|on|the|a|an|in|to|from|into|should|be|button|link|field|input)\b/gi, '')
      .trim()
      .split(/[\s'"""''.,;:]+/)
      .filter((w) => w.length > 2)
      .slice(0, 3)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

    return prefix + words.join('');
  }

  /**
   * Builds verify/assertion steps from a step's expected result.
   */
  private static _buildVerifySteps(
    step: { action: string; expected: string },
    pageName: string,
    elementRefs: Map<string, string>
  ): string[] {
    const results: string[] = [];
    const expected = step.expected;
    const expectedLower = expected.toLowerCase();

    // Pattern: "should be visible" or "should be displayed"
    if (expectedLower.includes('visible') || expectedLower.includes('displayed') || expectedLower.includes('shown')) {
      const ref = this._findElementRef(step.action + ' ' + step.expected, pageName, elementRefs);
      if (ref) {
        results.push(`Then '${ref}' should be visible`);
      }
    }

    // Pattern: "should have text X" or "should show X"
    const textMatch = expected.match(/(?:should\s+(?:have|show|display)\s+(?:text\s+)?|heading\s+)['"""''']([^'"""''']+)['"""''']/i)
      || expected.match(/(?:shows?|displays?|contains?)\s+['"""''']([^'"""''']+)['"""''']/i);
    if (textMatch) {
      const ref = this._findElementRef(step.action + ' ' + step.expected, pageName, elementRefs);
      if (ref) {
        results.push(`Then '${ref}' should have text '${textMatch[1]}'`);
      }
    }

    // Pattern: URL should contain
    const urlMatch = expected.match(/url\s+(?:should\s+)?contain[s]?\s+['"""''']([^'"""''']+)['"""''']/i)
      || expected.match(/redirect.*?to\s+.*?\/([^\s'"]+)/i)
      || expected.match(/navigate.*?(?:to\s+)?\/([^\s'"]+)/i);
    if (urlMatch) {
      results.push(`Then the url should contain '${urlMatch[1]}'`);
    }

    // Pattern: color assertions
    const colorMatch = expected.match(/(red|green|blue|orange)\s+(?:color|text)/i)
      || expected.match(/color\s+(?:should\s+be\s+)?(red|green|blue|orange)/i);
    if (colorMatch) {
      const ref = this._findElementRef(step.action + ' ' + step.expected, pageName, elementRefs);
      if (ref) {
        results.push(`Then '${ref}' should have color '${colorMatch[1].toLowerCase()}'`);
      }
    }

    // If no specific assertion matched, add a generic visible check
    if (results.length === 0 && step.expected) {
      results.push(`# EXPECTED: ${step.expected}`);
    }

    return results;
  }

  /**
   * Builds assertions from the expected result text when the primary action was NOT a verify.
   */
  private static _buildExpectedAssertions(
    expected: string,
    pageName: string,
    elementRefs: Map<string, string>
  ): string[] {
    const results: string[] = [];
    const expectedLower = expected.toLowerCase();

    // Skip if expected is just confirmation of a click/enter action
    if (expectedLower.includes('button') && expectedLower.includes('enabled')) return results;
    if (expectedLower.includes('form') && (expectedLower.includes('visible') || expectedLower.includes('shown'))) return results;

    // URL assertions
    const urlMatch = expected.match(/(?:url|page|redirect).*?(?:contain|show|display).*?['"""''']([^'"""''']+)['"""''']/i)
      || expected.match(/\/([a-z][\w-/]*)/i);
    if (urlMatch && expectedLower.includes('url') || expectedLower.includes('redirect') || expectedLower.includes('navigate')) {
      results.push(`Then the url should contain '${urlMatch![1]}'`);
      return results;
    }

    // Element visibility with text
    const textInExpected = expected.match(/['"""''']([^'"""''']+)['"""''']/);
    if (textInExpected && (expectedLower.includes('display') || expectedLower.includes('show') || expectedLower.includes('visible') || expectedLower.includes('heading'))) {
      const ref = this._findElementRef(expected, pageName, elementRefs);
      if (ref) {
        results.push(`Then '${ref}' should be visible`);
      }
    }

    return results;
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private static _formatTestCase(tc: PlanTestCase): string {
    const lines: string[] = [];
    lines.push(`### ${tc.id}: ${tc.title}`);
    lines.push(`Type: ${tc.type}`);
    if (tc.navigation) lines.push(`Navigation: ${tc.navigation}`);
    lines.push('Steps:');
    tc.steps.forEach((s) => {
      const parts = [`  Step ${s.stepNo}:`];
      if (s.action) parts.push(`Action: ${s.action}`);
      if (s.navigation) parts.push(`Navigate: ${s.navigation}`);
      if (s.testData) parts.push(`Data: ${s.testData}`);
      if (s.expected) parts.push(`Expected: ${s.expected}`);
      lines.push(parts.join(' | '));
    });
    if (tc.edgeCases?.length > 0) {
      lines.push(`Edge Cases: ${tc.edgeCases.join('; ')}`);
    }
    lines.push('');
    return lines.join('\n');
  }

  private static _getTags(type: string): string {
    switch (type) {
      case 'happy_path': return '@smoke @e2e';
      case 'negative':   return '@negative @regression';
      case 'edge_case':  return '@regression';
      case 'navigation': return '@smoke';
      default:           return '@regression';
    }
  }
}
