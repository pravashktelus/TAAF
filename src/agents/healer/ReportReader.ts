import * as fs from 'fs';
import * as path from 'path';

/**
 * Represents a single step result from the Cucumber report.
 */
export interface StepResult {
  keyword: string;
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'pending';
  errorMessage?: string;
  duration?: number;
}

/**
 * Represents a single scenario result from the Cucumber report.
 */
export interface ScenarioResult {
  id: string;
  name: string;
  featureFile: string;
  status: 'passed' | 'failed' | 'skipped';
  steps: StepResult[];
  failedStep?: StepResult;
  tags: string[];
  duration: number;
}

/**
 * Represents the full run summary.
 */
export interface RunSummary {
  totalScenarios: number;
  passed: number;
  failed: number;
  skipped: number;
  scenarios: ScenarioResult[];
  healedElements: HealedElement[];
  runDate: string;
}

/**
 * Represents a self-healed element detected from screenshot filenames.
 */
export interface HealedElement {
  elementRef: string;     // e.g. "TeleConnect.BtnNewConnection"
  pageName: string;       // e.g. "TeleConnect"
  elementKey: string;     // e.g. "BtnNewConnection"
  screenshotPath: string; // path to healed screenshot
}

/**
 * ReportReader
 * ------------
 * Reads all available report artifacts after a test run:
 *   - reports/cucumber-json/cucumber-report.json
 *   - reports/screenshots/healed_*.png (self-healing signals)
 *   - reports/failure-analysis/failure_*.md (existing RCA reports)
 *
 * Used by FailureClassifier and HealingReportWriter.
 */
export class ReportReader {
  private reportsDir: string;

  constructor() {
    this.reportsDir = path.resolve(process.cwd(), 'reports');
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Reads the full run summary from all available reports.
   * @param reportPath - Optional custom path to cucumber-report.json
   */
  read(reportPath?: string): RunSummary {
    const cucumberReportPath = reportPath
      || path.join(this.reportsDir, 'cucumber-json', 'cucumber-report.json');

    if (!fs.existsSync(cucumberReportPath)) {
      throw new Error(`[ReportReader] Report not found: ${cucumberReportPath}\nRun npm test first to generate reports.`);
    }

    console.log(`[ReportReader] Reading: ${cucumberReportPath}`);

    const raw = JSON.parse(fs.readFileSync(cucumberReportPath, 'utf-8'));
    const scenarios = this._parseScenarios(raw);
    const healedElements = this._detectHealedElements();

    const passed = scenarios.filter((s) => s.status === 'passed').length;
    const failed = scenarios.filter((s) => s.status === 'failed').length;
    const skipped = scenarios.filter((s) => s.status === 'skipped').length;

    console.log(`[ReportReader] Found: ${scenarios.length} scenarios (${passed} passed, ${failed} failed, ${skipped} skipped)`);
    console.log(`[ReportReader] Self-healed elements detected: ${healedElements.length}`);

    return {
      totalScenarios: scenarios.length,
      passed,
      failed,
      skipped,
      scenarios,
      healedElements,
      runDate: new Date().toISOString(),
    };
  }

  /**
   * Reads existing RCA report for a scenario if available.
   */
  readExistingRCA(scenarioName: string): string {
    const failureDir = path.join(this.reportsDir, 'failure-analysis');
    if (!fs.existsSync(failureDir)) return '';

    const files = fs.readdirSync(failureDir).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(failureDir, file), 'utf-8');
      if (content.includes(scenarioName)) {
        return content.substring(0, 1000); // return first 1000 chars
      }
    }
    return '';
  }

  // ─── Private: Cucumber Report Parsing ────────────────────────────────────

  private _parseScenarios(raw: any[]): ScenarioResult[] {
    const scenarios: ScenarioResult[] = [];

    for (const feature of raw) {
      const featureFile = feature.uri || feature.id || 'unknown';
      const elements = feature.elements || [];

      for (const element of elements) {
        if (element.keyword === 'Background') continue;

        const steps: StepResult[] = (element.steps || [])
          .filter((s: any) => !s.hidden)
          .map((s: any) => ({
            keyword: s.keyword?.trim() || '',
            name: s.name || '',
            status: s.result?.status || 'skipped',
            errorMessage: s.result?.error_message || undefined,
            duration: s.result?.duration || 0,
          }));

        const failedStep = steps.find((s) => s.status === 'failed');
        const allPassed = steps.every((s) => s.status === 'passed' || s.status === 'skipped');
        const status = failedStep ? 'failed' : allPassed ? 'passed' : 'skipped';

        const totalDuration = steps.reduce((sum, s) => sum + (s.duration || 0), 0);
        const tags = (element.tags || []).map((t: any) => t.name || t);

        scenarios.push({
          id: element.id || element.name,
          name: element.name || 'Unknown Scenario',
          featureFile,
          status,
          steps,
          failedStep,
          tags,
          duration: Math.round(totalDuration / 1000000), // nanoseconds to ms
        });
      }
    }

    return scenarios;
  }

  // ─── Private: Healed Element Detection ───────────────────────────────────

  private _detectHealedElements(): HealedElement[] {
    const screenshotsDir = path.join(this.reportsDir, 'screenshots');
    if (!fs.existsSync(screenshotsDir)) return [];

    const healedFiles = fs.readdirSync(screenshotsDir)
      .filter((f) => f.startsWith('healed_'));

    const seen = new Set<string>();
    const healedElements: HealedElement[] = [];

    for (const file of healedFiles) {
      // Pattern: healed_{PageName}_{ElementKey}_{timestamp}.png
      // e.g. healed_TeleConnect_BtnNewConnection_1780043255275.png
      const match = file.match(/^healed_([^_]+)_(.+?)_\d+/);
      if (!match) continue;

      const pageName = match[1];
      const elementKey = match[2];
      const ref = `${pageName}.${elementKey}`;

      if (seen.has(ref)) continue;
      seen.add(ref);

      healedElements.push({
        elementRef: ref,
        pageName,
        elementKey,
        screenshotPath: path.join(screenshotsDir, file),
      });
    }

    return healedElements;
  }
}
