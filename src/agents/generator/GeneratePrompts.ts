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
   * Fallback feature file template when AI is unavailable.
   */
  static buildFallback(plan: TestPlan, elementRefs: Map<string, string>): string {
    const moduleName = plan.page.toLowerCase();
    const lines: string[] = [];

    lines.push(`@web @${moduleName}_web`);
    lines.push(`Feature: ${plan.page} - Generated Feature`);
    lines.push(`  # Source: ${plan.sourceFile}`);
    lines.push(`  # TODO: AI unavailable — complete scenario steps manually`);
    lines.push(`  # Available elements:`);

    elementRefs.forEach((ref) => {
      lines.push(`  #   ${ref}`);
    });

    lines.push('');

    plan.testCases.forEach((tc) => {
      const tags = this._getTags(tc.type);
      lines.push(`  ${tags}`);
      lines.push(`  Scenario: ${tc.id} ${tc.title}`);
      lines.push(`    Given I navigate to the application`);
      lines.push(`    # Navigation: ${tc.navigation || 'TODO: Add navigation'}`);

      tc.steps.forEach((s) => {
        lines.push(`    # Step ${s.stepNo}: ${s.action}`);
        if (s.testData) lines.push(`    # Test Data: ${s.testData}`);
        lines.push(`    # Expected: ${s.expected}`);
        lines.push(`    # TODO: Add automation steps here`);
      });

      if (tc.edgeCases?.length > 0) {
        lines.push(`    # Edge Cases:`);
        tc.edgeCases.forEach((ec) => lines.push(`    #   - ${ec}`));
      }

      lines.push('');
    });

    return lines.join('\n');
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
