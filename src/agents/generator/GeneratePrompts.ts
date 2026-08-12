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
   * This is the core P3 fix: deterministic, uses real element refs from registry.
   */
  private static _mapStepToGherkin(
    step: { stepNo: number; action: string; navigation: string; testData: string; expected: string },
    pageName: string,
    elementRefs: Map<string, string>
  ): string[] {
    const results: string[] = [];
    const action = step.action.toLowerCase();

    // Add section comment
    results.push(`# ═══ Step ${step.stepNo}: ${step.action.substring(0, 60)} ═══`);

    // ─── Split compound actions ("enter X and click Y") ─────────────────
    if (action.includes(' and ') && (action.includes('enter') || action.includes('type')) && action.includes('click')) {
      const parts = step.action.split(/\s+and\s+/i);
      for (const part of parts) {
        const subStep = { ...step, action: part.trim(), stepNo: step.stepNo };
        const subResults = this._mapSingleAction(subStep, pageName, elementRefs);
        results.push(...subResults);
      }
      // Add assertions from expected
      if (step.expected) {
        const assertions = this._mapExpectedToAssertions(step.expected, pageName, elementRefs);
        results.push(...assertions);
      }
      return results;
    }

    // ─── Single action mapping ──────────────────────────────────────────
    const actionSteps = this._mapSingleAction(step, pageName, elementRefs);
    results.push(...actionSteps);

    // ─── Always map expected results to assertions ──────────────────────
    if (step.expected) {
      const assertions = this._mapExpectedToAssertions(step.expected, pageName, elementRefs);
      results.push(...assertions);
    }

    return results;
  }

  /**
   * Maps a single (non-compound) action to Gherkin steps.
   */
  private static _mapSingleAction(
    step: { action: string; testData: string; expected: string },
    pageName: string,
    elementRefs: Map<string, string>
  ): string[] {
    const results: string[] = [];
    const action = step.action.toLowerCase();

    // ─── Pattern: Login/Credentials ─────────────────────────────────────
    if ((action.includes('credential') || (action.includes('enter') && action.includes('login'))) && !action.includes('navigate')) {
      const emailRef = this._findByRole(elementRefs, 'login', 'email') || this._findByRole(elementRefs, 'signin', 'email');
      const passRef = this._findByRole(elementRefs, 'login', 'password') || this._findByRole(elementRefs, 'signin', 'password');
      const { email, password } = this._parseCredentials(step.testData);
      if (emailRef) results.push(`When I enter '${email}' into '${emailRef}'`);
      if (passRef) results.push(`When I enter '${password}' into '${passRef}'`);
      return results;
    }

    // ─── Pattern: Click Sign In / Submit / Login button ─────────────────
    if (action.includes('sign in') || action.includes('signin') || (action.includes('click') && action.includes('login') && !action.includes('signup'))) {
      const ref = this._findByRole(elementRefs, 'login', 'submit') || this._findByRole(elementRefs, 'btn', 'login');
      if (ref) results.push(`When I click '${ref}'`);
      else results.push(`When I click '${pageName}.BtnLogin'`);
      return results;
    }

    // ─── Pattern: Click navigation link ─────────────────────────────────
    if (action.includes('navigation link') || action.includes('nav link') || action.includes('in the navigation')) {
      const navTarget = this._extractNavTarget(step.action);
      const ref = this._findByRole(elementRefs, 'nav', navTarget);
      if (ref) results.push(`When I click '${ref}'`);
      else results.push(`When I click '${pageName}.Nav${this._capitalize(navTarget)}'`);
      return results;
    }

    // ─── Pattern: Click with specific target ────────────────────────────
    if (action.includes('click')) {
      const target = this._extractClickTarget(step.action);
      const ref = this._findByRole(elementRefs, 'btn', target)
        || this._findByRole(elementRefs, 'nav', target)
        || this._findByKeyword(elementRefs, target);
      if (ref) results.push(`When I click '${ref}'`);
      else results.push(`When I click '${pageName}.Btn${this._capitalize(target)}'`);
      return results;
    }

    // ─── Pattern: Navigate to application ───────────────────────────────
    if (action.includes('navigate') && (action.includes('application') || action.includes('login page') || action.includes('homepage'))) {
      // Already handled by "Given I navigate to the application" at scenario start
      return results;
    }

    // ─── Pattern: Navigate to URL ───────────────────────────────────────
    if (action.includes('navigate') || action.includes('go to') || action.includes('open')) {
      const urlMatch = step.action.match(/https?:\/\/[^\s'"]+/) || step.testData.match(/https?:\/\/[^\s'"]+/);
      if (urlMatch) results.push(`Given I navigate to '${urlMatch[0]}'`);
      return results;
    }

    // ─── Pattern: Enter / Type into field ───────────────────────────────
    if (action.includes('enter') || action.includes('type') || action.includes('fill')) {
      const fieldHint = this._extractFieldTarget(step.action);
      const ref = this._findByRole(elementRefs, 'input', fieldHint)
        || this._findByKeyword(elementRefs, fieldHint);
      const value = this._extractSimpleValue(step);
      if (ref) results.push(`When I enter '${value}' into '${ref}'`);
      else results.push(`When I enter '${value}' into '${pageName}.Input${this._capitalize(fieldHint)}'`);
      return results;
    }

    // ─── Pattern: Select / Dropdown ─────────────────────────────────────
    if (action.includes('select')) {
      const fieldHint = this._extractFieldTarget(step.action);
      const ref = this._findByRole(elementRefs, 'select', fieldHint);
      const value = this._extractSimpleValue(step);
      if (ref) results.push(`When I select '${value}' from dropdown '${ref}'`);
      else results.push(`When I select '${value}' from dropdown '${pageName}.Select${this._capitalize(fieldHint)}'`);
      return results;
    }

    // ─── Pattern: Verify / Validate ─────────────────────────────────────
    if (action.includes('verify') || action.includes('validate') || action.includes('check') || action.includes('should')) {
      // Assertions are handled in _mapExpectedToAssertions — just add a comment
      return results;
    }

    // ─── Pattern: Wait ──────────────────────────────────────────────────
    if (action.includes('wait')) {
      const seconds = action.match(/(\d+)/)?.[1] || '2';
      results.push(`When I wait ${seconds} seconds`);
      return results;
    }

    // ─── Fallback ───────────────────────────────────────────────────────
    results.push(`# ACTION: ${step.action}`);
    return results;
  }

  /**
   * Maps the expected result text into assertion Gherkin steps.
   * This ensures every plan step with an expected result produces Then assertions.
   */
  private static _mapExpectedToAssertions(
    expected: string,
    pageName: string,
    elementRefs: Map<string, string>
  ): string[] {
    const results: string[] = [];
    const expectedLower = expected.toLowerCase();

    // ─── URL assertion ──────────────────────────────────────────────────
    const urlMatch = expected.match(/url\s+(?:should\s+)?contain[s]?\s+['"""']([^'"""']+)['"""']/i)
      || expected.match(/(?:redirect|navigate).*?['"""']([^'"""']+)['"""']/i);
    if (urlMatch) {
      results.push(`Then the url should contain '${urlMatch[1]}'`);
    }

    // ─── Text/heading assertion ─────────────────────────────────────────
    const textMatches = expected.match(/['"""']([^'"""']+)['"""']/g);
    if (textMatches && (expectedLower.includes('heading') || expectedLower.includes('message') || expectedLower.includes('display') || expectedLower.includes('show') || expectedLower.includes('visible') || expectedLower.includes('text'))) {
      // Extract the first quoted value as the expected text
      const firstQuoted = textMatches[0].replace(/['"""']/g, '');
      const ref = this._findByKeyword(elementRefs, firstQuoted.replace(/\s+/g, '').substring(0, 15));
      if (ref) {
        results.push(`Then '${ref}' should be visible`);
      } else {
        results.push(`Then '${pageName}.${this._capitalize(firstQuoted.replace(/\s+/g, '').substring(0, 20))}' should be visible`);
      }
    }

    // ─── Generic visible assertion (if no specific match above) ─────────
    if (results.length === 0 && (expectedLower.includes('visible') || expectedLower.includes('displayed') || expectedLower.includes('shown'))) {
      const target = expected.replace(/\b(should|be|is|are|visible|displayed|shown|the|a|an|with)\b/gi, '').trim().split(/\s+/).slice(0, 3).join('');
      if (target.length > 3) {
        const ref = this._findByKeyword(elementRefs, target);
        if (ref) results.push(`Then '${ref}' should be visible`);
        else results.push(`Then '${pageName}.${this._capitalize(target)}' should be visible`);
      }
    }

    // ─── Color assertion ────────────────────────────────────────────────
    const colorMatch = expectedLower.match(/(red|green|blue|orange)\s+(?:color|text)/);
    if (colorMatch) {
      results.push(`# VERIFY: ${expected} (color assertion — add element ref)`);
    }

    // If nothing matched, add as comment for manual review
    if (results.length === 0 && expected.length > 10) {
      results.push(`# EXPECTED: ${expected}`);
    }

    return results;
  }

  // ─── Improved Element Matching Helpers ────────────────────────────────────

  /**
   * Finds an element ref by role prefix + keyword.
   * e.g. findByRole(refs, 'login', 'email') → 'TeleConnect.LoginEmail'
   * e.g. findByRole(refs, 'nav', 'orders') → 'TeleConnect.NavOrders'
   */
  private static _findByRole(
    elementRefs: Map<string, string>,
    rolePrefix: string,
    keyword: string
  ): string | null {
    const roleLower = rolePrefix.toLowerCase();
    const kwLower = keyword.toLowerCase();

    for (const [, ref] of elementRefs) {
      const refLower = ref.toLowerCase();
      const parts = ref.split('.');
      if (parts.length < 2) continue;
      const elementKey = parts[1].toLowerCase();

      // Exact role+keyword match: "LoginEmail", "NavOrders", "BtnSignIn"
      if (elementKey.includes(roleLower) && elementKey.includes(kwLower)) {
        return ref;
      }
    }

    // Looser: just keyword in element key with right prefix pattern
    for (const [, ref] of elementRefs) {
      const parts = ref.split('.');
      if (parts.length < 2) continue;
      const elementKey = parts[1].toLowerCase();

      if (roleLower === 'btn' && elementKey.startsWith('btn') && elementKey.includes(kwLower)) return ref;
      if (roleLower === 'nav' && elementKey.startsWith('nav') && elementKey.includes(kwLower)) return ref;
      if (roleLower === 'input' && (elementKey.startsWith('input') || elementKey.includes(kwLower)) && elementKey.includes(kwLower)) return ref;
      if (roleLower === 'select' && elementKey.startsWith('select') && elementKey.includes(kwLower)) return ref;
    }

    return null;
  }

  /**
   * Finds an element ref by keyword match in the element key.
   */
  private static _findByKeyword(elementRefs: Map<string, string>, keyword: string): string | null {
    if (!keyword || keyword.length < 3) return null;
    const kwLower = keyword.toLowerCase();

    for (const [, ref] of elementRefs) {
      const parts = ref.split('.');
      if (parts.length < 2) continue;
      const elementKey = parts[1].toLowerCase();
      if (elementKey.includes(kwLower)) return ref;
    }
    return null;
  }

  /**
   * Parses credentials from testData like "{Email: 'x', Password: 'y'}"
   */
  private static _parseCredentials(testData: string): { email: string; password: string } {
    const emailMatch = testData.match(/[Ee]mail['":\s]*['"]([^'"]+)['"]/);
    const passMatch = testData.match(/[Pp]assword['":\s]*['"]([^'"]+)['"]/);
    return {
      email: emailMatch ? emailMatch[1] : '$$Email',
      password: passMatch ? passMatch[1] : '$$Password',
    };
  }

  /**
   * Extracts the navigation target from action text.
   * e.g. "Click on 'My Orders' navigation link" → "orders"
   */
  private static _extractNavTarget(action: string): string {
    const quoted = action.match(/['"""']([^'"""']+)['"""']/);
    if (quoted) {
      // Strip common prefixes: "My Orders" → "Orders", "The Dashboard" → "Dashboard"
      return quoted[1].replace(/\b(my|the|a|an)\b/gi, '').replace(/\s+/g, '').toLowerCase();
    }
    // Remove common verbs
    const cleaned = action.replace(/\b(click|on|the|my|a|an|navigation|link|nav|menu|item)\b/gi, '').trim();
    const words = cleaned.split(/\s+/).filter((w) => w.length > 2);
    return words.join('').toLowerCase();
  }

  /**
   * Extracts the click target from action text.
   * e.g. "Click 'View Details' on an order card" → "viewdetails"
   */
  private static _extractClickTarget(action: string): string {
    const quoted = action.match(/['"""']([^'"""']+)['"""']/);
    if (quoted) return quoted[1].replace(/\s+/g, '');
    const cleaned = action.replace(/\b(click|on|the|a|an|button|link|icon)\b/gi, '').trim();
    const words = cleaned.split(/\s+/).filter((w) => w.length > 2);
    return words.slice(0, 3).join('');
  }

  /**
   * Extracts field target from enter/type actions.
   * e.g. "Enter email into search box" → "search"
   */
  private static _extractFieldTarget(action: string): string {
    const intoMatch = action.match(/into\s+(?:the\s+)?['"""']?([^'"""']+?)['"""']?\s*(?:field|box|input)?$/i);
    if (intoMatch) return intoMatch[1].replace(/\s+/g, '');
    const cleaned = action.replace(/\b(enter|type|fill|into|the|field|form|input|box)\b/gi, '').trim();
    const words = cleaned.split(/\s+/).filter((w) => w.length > 2);
    return words.slice(-2).join('');
  }

  /**
   * Extracts verify target from action/expected text.
   */
  private static _extractVerifyTarget(action: string, expected: string): string {
    const combined = `${action} ${expected}`;
    const quoted = combined.match(/['"""']([^'"""']+)['"""']/);
    if (quoted) return quoted[1].replace(/\s+/g, '');
    const cleaned = combined.replace(/\b(verify|validate|check|should|be|is|are|visible|displayed|shown|at least|one|the)\b/gi, '').trim();
    const words = cleaned.split(/\s+/).filter((w) => w.length > 2);
    return words.slice(0, 3).join('');
  }

  /**
   * Extracts a simple value from testData or action text.
   */
  private static _extractSimpleValue(step: { action: string; testData: string }): string {
    if (step.testData) {
      // If it starts with $$ or ## or {, it's a framework variable
      if (step.testData.startsWith('$$') || step.testData.startsWith('##') || step.testData.startsWith('{')) {
        // Check if it's a JSON-like object — extract first simple value
        const simpleVal = step.testData.match(/['"]([^'"{}]+)['"]/);
        if (simpleVal) return simpleVal[1];
        return step.testData;
      }
      return step.testData;
    }
    const quoted = step.action.match(/['"""']([^'"""']+)['"""']/);
    if (quoted) return quoted[1];
    return '##Value';
  }

  private static _capitalize(str: string): string {
    if (!str) return 'Unknown';
    return str.charAt(0).toUpperCase() + str.slice(1);
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
