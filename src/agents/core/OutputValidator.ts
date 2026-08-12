import * as fs from 'fs';
import * as path from 'path';
import { PropertiesRegistry } from './PropertiesRegistry';
import { TestPlan } from '../planner/PlanFormatter';

/**
 * OutputValidator
 * ---------------
 * Validates generated feature files before they are applied to features/web/.
 * Catches issues that would cause immediate test failures:
 *   - Element refs with no valid locator in .properties
 *   - Scenario count mismatch with plan
 *   - TODO locator values in .properties files
 *   - Malformed step lines
 *
 * Used by GeneratorAgent as a gate before --apply.
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    scenarioCount: number;
    planTestCaseCount: number;
    resolvedElements: number;
    unresolvedElements: number;
    totalSteps: number;
  };
}

export class OutputValidator {
  private registry: PropertiesRegistry;

  constructor(registry?: PropertiesRegistry) {
    this.registry = registry || new PropertiesRegistry();
    if (!registry) this.registry.load();
  }

  /**
   * Validates a generated feature file against the plan and properties registry.
   *
   * @param featureContent - The generated .feature file content
   * @param plan           - The source plan JSON
   * @param isApply        - Whether --apply flag is set (stricter validation)
   */
  validate(featureContent: string, plan: TestPlan, isApply: boolean = false): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // ─── 1. Scenario count vs plan test cases ────────────────────────────
    const scenarioMatches = featureContent.match(/^\s*Scenario:/gm) || [];
    const scenarioCount = scenarioMatches.length;
    const planTestCaseCount = plan.testCases.length;

    if (scenarioCount === 0) {
      errors.push('Feature file has no scenarios.');
    } else if (scenarioCount !== planTestCaseCount) {
      warnings.push(
        `Scenario count (${scenarioCount}) does not match plan test case count (${planTestCaseCount}).`
      );
    }

    // ─── 2. Check all element refs have valid locators ───────────────────
    const elementRefPattern = /'([A-Z][a-zA-Z0-9]+)\.([A-Za-z][A-Za-z0-9]+)'/g;
    const allRefs = new Set<string>();
    const unresolvedRefs: string[] = [];
    let refMatch;

    while ((refMatch = elementRefPattern.exec(featureContent)) !== null) {
      const pageName = refMatch[1];
      const elementKey = refMatch[2];
      const fullRef = `${pageName}.${elementKey}`;

      if (allRefs.has(fullRef)) continue;
      allRefs.add(fullRef);

      // Check registry
      const pageElements = this.registry.getPageElements(pageName);
      const exists = pageElements.some((el) => el.elementKey === elementKey);

      if (!exists) {
        // Check if the page's .properties file exists at all
        const propsPath = path.resolve(
          process.cwd(), 'src', 'pages', 'properties', `${pageName}.properties`
        );
        if (!fs.existsSync(propsPath)) {
          unresolvedRefs.push(`${fullRef} (no ${pageName}.properties file)`);
        } else {
          unresolvedRefs.push(`${fullRef} (key not found in ${pageName}.properties)`);
        }
      }
    }

    if (unresolvedRefs.length > 0 && isApply) {
      errors.push(
        `${unresolvedRefs.length} element ref(s) have no valid locator in .properties:\n` +
        unresolvedRefs.map((r) => `    - ${r}`).join('\n')
      );
    } else if (unresolvedRefs.length > 0) {
      warnings.push(
        `${unresolvedRefs.length} element ref(s) have no locator — tests will fail for these:\n` +
        unresolvedRefs.map((r) => `    - ${r}`).join('\n')
      );
    }

    // ─── 3. Check for TODO locator values in .properties files ───────────
    const propsDir = path.resolve(process.cwd(), 'src', 'pages', 'properties');
    const referencedPages = new Set<string>();
    allRefs.forEach((ref) => referencedPages.add(ref.split('.')[0]));

    for (const pageName of referencedPages) {
      const propsPath = path.join(propsDir, `${pageName}.properties`);
      if (!fs.existsSync(propsPath)) continue;

      const content = fs.readFileSync(propsPath, 'utf-8');
      const todoLocators = content.split('\n')
        .filter((l) => l.includes('=') && !l.startsWith('#'))
        .filter((l) => {
          const value = l.split('=').slice(1).join('=').trim();
          return value.startsWith('# TODO') || value.startsWith('#TODO');
        });

      if (todoLocators.length > 0) {
        if (isApply) {
          errors.push(
            `${pageName}.properties has ${todoLocators.length} TODO locator value(s) — these will crash at runtime:\n` +
            todoLocators.map((l) => `    - ${l.split('=')[0].trim()}`).join('\n')
          );
        } else {
          warnings.push(
            `${pageName}.properties has ${todoLocators.length} TODO locator(s) — update before running tests.`
          );
        }
      }
    }

    // ─── 4. Check for malformed step lines ───────────────────────────────
    const stepLines = featureContent.split('\n')
      .filter((l) => l.trim().match(/^\s*(Given|When|Then|And|But)\s/));

    const malformedSteps: string[] = [];
    for (const stepLine of stepLines) {
      const trimmed = stepLine.trim();

      // Steps with appended comments (breaks Cucumber regex)
      if (trimmed.match(/^(Given|When|Then|And|But)\s.+#\s*(TODO|FIXME|NOTE)/i)) {
        malformedSteps.push(trimmed.substring(0, 80));
      }
    }

    if (malformedSteps.length > 0) {
      errors.push(
        `${malformedSteps.length} step line(s) have inline comments that break Cucumber:\n` +
        malformedSteps.map((s) => `    - ${s}`).join('\n')
      );
    }

    // ─── 5. Count total steps ────────────────────────────────────────────
    const totalSteps = stepLines.length;

    // ─── Build result ────────────────────────────────────────────────────
    const valid = errors.length === 0;

    return {
      valid,
      errors,
      warnings,
      stats: {
        scenarioCount,
        planTestCaseCount,
        resolvedElements: allRefs.size - unresolvedRefs.length,
        unresolvedElements: unresolvedRefs.length,
        totalSteps,
      },
    };
  }

  /**
   * Prints validation results to console in a readable format.
   */
  printResults(result: ValidationResult): void {
    console.log('\n[OutputValidator] ─── Validation Results ───────────────────');
    console.log(`  Scenarios: ${result.stats.scenarioCount} (plan has ${result.stats.planTestCaseCount} test cases)`);
    console.log(`  Steps: ${result.stats.totalSteps}`);
    console.log(`  Elements: ${result.stats.resolvedElements} resolved, ${result.stats.unresolvedElements} unresolved`);

    if (result.warnings.length > 0) {
      console.warn('\n  ⚠️  Warnings:');
      result.warnings.forEach((w) => console.warn(`    ${w}`));
    }

    if (result.errors.length > 0) {
      console.error('\n  ❌ Errors (blocking --apply):');
      result.errors.forEach((e) => console.error(`    ${e}`));
    }

    if (result.valid) {
      console.log('\n  ✅ Validation passed.');
    } else {
      console.error('\n  ❌ Validation FAILED — fix errors before applying.');
    }
    console.log('────────────────────────────────────────────────────────────\n');
  }
}
