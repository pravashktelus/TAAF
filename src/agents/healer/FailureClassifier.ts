import { ScenarioResult, HealedElement, RunSummary } from './ReportReader';
import { LLMClient } from '../core/LLMClient';
import { AgentsConfig } from '../config/AgentsConfig';

/**
 * Classification result for a single scenario failure.
 */
export interface Classification {
  scenarioName: string;
  featureFile: string;
  status: 'passed' | 'failed' | 'skipped';
  classification: 'app_fault' | 'test_fault' | 'healed' | 'review' | 'passed' | 'skipped';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  action: string;
  failedStep?: string;
  errorMessage?: string;
  healedElements?: HealedElement[];
  propertiesFile?: string;
  suggestedLocator?: string;
}

/**
 * FailureClassifier
 * -----------------
 * Classifies each scenario result into one of:
 *   - app_fault:  Real application bug → raise defect
 *   - test_fault: Stale locator / wrong step → update test
 *   - healed:     Self-healing fixed it at runtime → persist locator fix
 *   - review:     Ambiguous → needs human review
 *   - passed:     No action needed
 *   - skipped:    No action needed
 *
 * Uses rule-based classification first (fast, no AI cost).
 * Falls back to AI only for ambiguous cases.
 */
export class FailureClassifier {
  private config: AgentsConfig;

  constructor() {
    this.config = AgentsConfig.getInstance();
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Classifies all scenarios in a run summary.
   * Returns array of classifications sorted by priority (failed first).
   */
  async classifyAll(summary: RunSummary): Promise<Classification[]> {
    const results: Classification[] = [];

    for (const scenario of summary.scenarios) {
      const classification = await this._classify(scenario, summary.healedElements);
      results.push(classification);
    }

    // Sort: failed → healed → review → passed → skipped
    const order = { app_fault: 0, test_fault: 1, healed: 2, review: 3, passed: 4, skipped: 5 };
    results.sort((a, b) => (order[a.classification] ?? 5) - (order[b.classification] ?? 5));

    return results;
  }

  // ─── Private: Classification Logic ───────────────────────────────────────

  private async _classify(
    scenario: ScenarioResult,
    healedElements: HealedElement[]
  ): Promise<Classification> {

    // ── Passed ──────────────────────────────────────────────────────────────
    if (scenario.status === 'passed') {
      // Check if any elements were healed during this scenario
      const scenarioHeals = this._findHealedForScenario(scenario, healedElements);
      if (scenarioHeals.length > 0) {
        return {
          scenarioName: scenario.name,
          featureFile: scenario.featureFile,
          status: 'passed',
          classification: 'healed',
          confidence: 'high',
          reason: `Scenario passed but ${scenarioHeals.length} element(s) were self-healed at runtime.`,
          action: `Update .properties file(s) with healed locators to prevent repeated healing.`,
          healedElements: scenarioHeals,
          propertiesFile: `src/pages/properties/${scenarioHeals[0].pageName}.properties`,
        };
      }
      return this._passedResult(scenario);
    }

    // ── Skipped ──────────────────────────────────────────────────────────────
    if (scenario.status === 'skipped') {
      return {
        scenarioName: scenario.name,
        featureFile: scenario.featureFile,
        status: 'skipped',
        classification: 'skipped',
        confidence: 'high',
        reason: 'Scenario was skipped — likely a preceding scenario failed.',
        action: 'Fix the failing scenario that caused this skip.',
      };
    }

    // ── Failed — apply classification rules ──────────────────────────────────
    const error = scenario.failedStep?.errorMessage || '';
    const stepName = scenario.failedStep?.name || '';
    const errorLower = error.toLowerCase();

    // Rule 1: Assertion failure — element found but wrong value → APP FAULT
    if (this._isAssertionFailure(errorLower)) {
      return {
        scenarioName: scenario.name,
        featureFile: scenario.featureFile,
        status: 'failed',
        classification: 'app_fault',
        confidence: 'high',
        reason: `Assertion failed: element was found but had unexpected content.\nError: ${this._extractShortError(error)}`,
        action: '🐛 Raise a defect — the application is not behaving as expected.',
        failedStep: stepName,
        errorMessage: this._extractShortError(error),
      };
    }

    // Rule 2: API failure — wrong status code → APP FAULT
    if (this._isAPIFailure(errorLower)) {
      return {
        scenarioName: scenario.name,
        featureFile: scenario.featureFile,
        status: 'failed',
        classification: 'app_fault',
        confidence: 'high',
        reason: `API returned unexpected status code.\nError: ${this._extractShortError(error)}`,
        action: '🐛 Raise a defect — API response does not match expected behaviour.',
        failedStep: stepName,
        errorMessage: this._extractShortError(error),
      };
    }

    // Rule 3: Locator timeout / not found → TEST FAULT
    if (this._isLocatorFailure(errorLower)) {
      const elementRef = this._extractElementRef(stepName);
      return {
        scenarioName: scenario.name,
        featureFile: scenario.featureFile,
        status: 'failed',
        classification: 'test_fault',
        confidence: 'high',
        reason: `Element locator failed — element not found within timeout.\nStep: "${stepName}"`,
        action: `🔧 Update locator in .properties file.\nElement: ${elementRef || 'see failed step'}\nVerify locator in browser DevTools then update the .properties file.`,
        failedStep: stepName,
        errorMessage: this._extractShortError(error),
        propertiesFile: elementRef ? `src/pages/properties/${elementRef.split('.')[0]}.properties` : undefined,
      };
    }

    // Rule 4: Navigation / URL mismatch → REVIEW
    if (this._isNavigationFailure(errorLower)) {
      return {
        scenarioName: scenario.name,
        featureFile: scenario.featureFile,
        status: 'failed',
        classification: 'review',
        confidence: 'medium',
        reason: `Navigation or URL assertion failed.\nError: ${this._extractShortError(error)}`,
        action: '👁️  Review — check if application routing changed (app fault) or test navigation steps need updating (test fault).',
        failedStep: stepName,
        errorMessage: this._extractShortError(error),
      };
    }

    // Rule 5: Unknown — use AI if available, else mark as review
    return await this._classifyWithAI(scenario, error, stepName);
  }

  // ─── Private: Rule Matchers ───────────────────────────────────────────────

  private _isAssertionFailure(error: string): boolean {
    return (
      error.includes('tohavetext') ||
      error.includes('tocontaintext') ||
      error.includes('tohavevalue') ||
      error.includes('tobevisible') && error.includes('expected') ||
      error.includes('expected:') && error.includes('received:') ||
      error.includes('expect(') && !error.includes('timeout')
    );
  }

  private _isAPIFailure(error: string): boolean {
    return (
      error.includes('status code') ||
      error.includes('response status') ||
      error.includes('expected 200') ||
      error.includes('expected 201') ||
      /expected \d{3}/.test(error)
    );
  }

  private _isLocatorFailure(error: string): boolean {
    return (
      error.includes('timeout') ||
      error.includes('not found') ||
      error.includes('no element') ||
      error.includes('waiting for') ||
      error.includes('locator resolved to 0') ||
      error.includes('element not found') ||
      error.includes('self-heal') && error.includes('failed')
    );
  }

  private _isNavigationFailure(error: string): boolean {
    return (
      error.includes('url') && error.includes('contain') ||
      error.includes('navigation') ||
      error.includes('page title') ||
      error.includes('tobe') && error.includes('url')
    );
  }

  // ─── Private: AI Fallback ─────────────────────────────────────────────────

  private async _classifyWithAI(
    scenario: ScenarioResult,
    error: string,
    stepName: string
  ): Promise<Classification> {
    if (!this.config.aiEnabled) {
      return {
        scenarioName: scenario.name,
        featureFile: scenario.featureFile,
        status: 'failed',
        classification: 'review',
        confidence: 'low',
        reason: `Could not auto-classify. Error: ${this._extractShortError(error)}`,
        action: '👁️  Manual review needed — check test report and application logs.',
        failedStep: stepName,
        errorMessage: this._extractShortError(error),
      };
    }

    const prompt = `Classify this test automation failure:

Scenario: ${scenario.name}
Failed Step: "${stepName}"
Error: ${error.substring(0, 500)}

Is this:
A) APP_FAULT — the application has a real bug (wrong data, wrong behaviour, API error)
B) TEST_FAULT — the test has a stale locator, wrong step, or timing issue
C) REVIEW — ambiguous, needs human investigation

Reply in this EXACT format:
CLASSIFICATION: APP_FAULT|TEST_FAULT|REVIEW
REASON: (one sentence)
ACTION: (one sentence — what QA should do)`;

    const fallback = 'CLASSIFICATION: REVIEW\nREASON: Could not classify automatically.\nACTION: Manual review needed.';
    const response = await LLMClient.ask(prompt, fallback);

    // Parse AI response
    const classLine = response.match(/CLASSIFICATION:\s*(APP_FAULT|TEST_FAULT|REVIEW)/i);
    const reasonLine = response.match(/REASON:\s*(.+)/i);
    const actionLine = response.match(/ACTION:\s*(.+)/i);

    const aiClass = classLine?.[1]?.toLowerCase() || 'review';
    const classification = aiClass === 'app_fault' ? 'app_fault'
      : aiClass === 'test_fault' ? 'test_fault' : 'review';

    return {
      scenarioName: scenario.name,
      featureFile: scenario.featureFile,
      status: 'failed',
      classification,
      confidence: 'medium',
      reason: reasonLine?.[1] || `AI classification: ${aiClass}`,
      action: actionLine?.[1] || 'Review test report and application logs.',
      failedStep: stepName,
      errorMessage: this._extractShortError(error),
    };
  }

  // ─── Private: Utilities ───────────────────────────────────────────────────

  private _passedResult(scenario: ScenarioResult): Classification {
    return {
      scenarioName: scenario.name,
      featureFile: scenario.featureFile,
      status: 'passed',
      classification: 'passed',
      confidence: 'high',
      reason: 'Scenario passed successfully.',
      action: 'No action needed.',
    };
  }

  private _findHealedForScenario(
    scenario: ScenarioResult,
    healedElements: HealedElement[]
  ): HealedElement[] {
    // Match healed elements to scenario by checking page names referenced in steps
    const stepText = scenario.steps.map((s) => s.name).join(' ').toLowerCase();
    return healedElements.filter((h) =>
      stepText.includes(h.pageName.toLowerCase()) ||
      stepText.includes(h.elementKey.toLowerCase())
    );
  }

  private _extractElementRef(stepName: string): string {
    const match = stepName.match(/'([A-Z][a-zA-Z]+\.[A-Za-z]+)'/);
    return match?.[1] || '';
  }

  private _extractShortError(error: string): string {
    // Extract first meaningful line of error, strip ANSI codes
    const cleaned = error
      .replace(/\u001b\[[0-9;]*m/g, '') // strip ANSI
      .split('\n')
      .find((line) => line.trim().length > 10 && !line.includes('at ')) || error;
    return cleaned.substring(0, 200).trim();
  }
}
