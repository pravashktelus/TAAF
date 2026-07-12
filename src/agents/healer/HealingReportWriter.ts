import * as fs from 'fs';
import * as path from 'path';
import { Classification } from './FailureClassifier';
import { RunSummary } from './ReportReader';
import { AgentsConfig } from '../config/AgentsConfig';

/**
 * HealingReportWriter
 * -------------------
 * Writes the final healing report in two formats:
 *   - generated/reports/healing-report.md   (human-readable — QA opens this)
 *   - generated/reports/healing-report.json (structured — for future automation)
 *
 * The markdown report is designed to be immediately actionable:
 *   - Clear sections by priority (action required vs no action)
 *   - Exact file paths to update
 *   - Copy-paste ready suggestions
 */
export class HealingReportWriter {
  private outputDir: string;

  constructor() {
    const config = AgentsConfig.getInstance();
    this.outputDir = path.resolve(process.cwd(), config.outputDir, 'reports');
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Writes both .md and .json healing reports.
   * Returns paths to both files.
   */
  write(
    classifications: Classification[],
    summary: RunSummary
  ): { mdPath: string; jsonPath: string } {
    this._ensureOutputDir();

    const mdPath = this._writeMarkdown(classifications, summary);
    const jsonPath = this._writeJson(classifications, summary);

    return { mdPath, jsonPath };
  }

  // ─── Private: Markdown Report ─────────────────────────────────────────────

  private _writeMarkdown(
    classifications: Classification[],
    summary: RunSummary
  ): string {
    const filePath = path.join(this.outputDir, 'healing-report.md');
    const md = this._buildMarkdown(classifications, summary);
    fs.writeFileSync(filePath, md, 'utf-8');
    console.log(`[HealingReportWriter] Markdown report: ${filePath}`);
    return filePath;
  }

  private _buildMarkdown(
    classifications: Classification[],
    summary: RunSummary
  ): string {
    const lines: string[] = [];
    const runDate = new Date(summary.runDate).toLocaleString();

    // ── Header ──────────────────────────────────────────────────────────────
    lines.push('# 🏥 Healing Report');
    lines.push('');
    lines.push(`| Field | Value |`);
    lines.push(`|---|---|`);
    lines.push(`| Run Date | ${runDate} |`);
    lines.push(`| Total Scenarios | ${summary.totalScenarios} |`);
    lines.push(`| ✅ Passed | ${summary.passed} |`);
    lines.push(`| ❌ Failed | ${summary.failed} |`);
    lines.push(`| ⏭️  Skipped | ${summary.skipped} |`);
    lines.push(`| 🔧 Self-Healed Elements | ${summary.healedElements.length} |`);
    lines.push('');

    // ── Quick Summary ────────────────────────────────────────────────────────
    const appFaults = classifications.filter((c) => c.classification === 'app_fault');
    const testFaults = classifications.filter((c) => c.classification === 'test_fault');
    const healed = classifications.filter((c) => c.classification === 'healed');
    const reviews = classifications.filter((c) => c.classification === 'review');

    lines.push('## 📊 Quick Summary');
    lines.push('');
    if (appFaults.length > 0) lines.push(`- 🐛 **${appFaults.length} App Bug(s)** — raise defects`);
    if (testFaults.length > 0) lines.push(`- 🔧 **${testFaults.length} Test Issue(s)** — update locators/steps`);
    if (healed.length > 0) lines.push(`- ✨ **${healed.length} Self-Healed** — persist locator fixes`);
    if (reviews.length > 0) lines.push(`- 👁️  **${reviews.length} Need Review** — investigate manually`);
    if (appFaults.length === 0 && testFaults.length === 0 && healed.length === 0 && reviews.length === 0) {
      lines.push('- ✅ **All scenarios passed — no action needed!**');
    }
    lines.push('');

    // ── Action Required Section ──────────────────────────────────────────────
    const actionRequired = classifications.filter(
      (c) => ['app_fault', 'test_fault', 'healed', 'review'].includes(c.classification)
    );

    if (actionRequired.length > 0) {
      lines.push('---');
      lines.push('');
      lines.push('## 🔴 Action Required');
      lines.push('');

      for (const item of actionRequired) {
        lines.push(this._buildClassificationBlock(item));
      }
    }

    // ── No Action Needed Section ─────────────────────────────────────────────
    const passed = classifications.filter(
      (c) => c.classification === 'passed' || c.classification === 'skipped'
    );

    if (passed.length > 0) {
      lines.push('---');
      lines.push('');
      lines.push('## ✅ No Action Needed');
      lines.push('');
      for (const item of passed) {
        const icon = item.classification === 'passed' ? '✅' : '⏭️';
        lines.push(`- ${icon} **${item.scenarioName}** — ${item.reason}`);
      }
      lines.push('');
    }

    // ── Self-Healed Elements Detail ──────────────────────────────────────────
    if (summary.healedElements.length > 0) {
      lines.push('---');
      lines.push('');
      lines.push('## 🔧 Self-Healed Elements — Persist These Fixes');
      lines.push('');
      lines.push('The following elements were auto-healed at runtime. Update their `.properties` files to prevent repeated healing:\n');

      const byPage = new Map<string, typeof summary.healedElements>();
      for (const el of summary.healedElements) {
        if (!byPage.has(el.pageName)) byPage.set(el.pageName, []);
        byPage.get(el.pageName)!.push(el);
      }

      byPage.forEach((elements, pageName) => {
        lines.push(`### ${pageName}.properties`);
        lines.push(`File: \`src/pages/properties/${pageName}.properties\``);
        lines.push('');
        elements.forEach((el) => {
          lines.push(`- **${el.elementKey}** — healed locator visible in screenshot:`);
          lines.push(`  \`${el.screenshotPath}\``);
          lines.push(`  → Open screenshot → inspect healed element → update locator in .properties`);
        });
        lines.push('');
      });
    }

    // ── Footer ───────────────────────────────────────────────────────────────
    lines.push('---');
    lines.push('');
    lines.push('> Generated by Healer Agent | Run `npm run agent:heal` after each test run');
    lines.push('> For full test details see: `reports/html/index.html`');

    return lines.join('\n');
  }

  private _buildClassificationBlock(item: Classification): string {
    const lines: string[] = [];
    const icon = item.classification === 'app_fault' ? '🐛'
      : item.classification === 'test_fault' ? '🔧'
      : item.classification === 'healed' ? '✨'
      : '👁️';

    const label = item.classification === 'app_fault' ? 'APP BUG'
      : item.classification === 'test_fault' ? 'TEST ISSUE'
      : item.classification === 'healed' ? 'SELF-HEALED (persist fix)'
      : 'NEEDS REVIEW';

    lines.push(`### ${icon} ${item.scenarioName}`);
    lines.push('');
    lines.push(`| Field | Value |`);
    lines.push(`|---|---|`);
    lines.push(`| Classification | **${label}** |`);
    lines.push(`| Confidence | ${item.confidence} |`);
    lines.push(`| Feature File | \`${item.featureFile}\` |`);
    if (item.failedStep) lines.push(`| Failed Step | \`${item.failedStep}\` |`);
    if (item.propertiesFile) lines.push(`| Properties File | \`${item.propertiesFile}\` |`);
    lines.push('');

    lines.push(`**Reason:** ${item.reason}`);
    lines.push('');
    lines.push(`**Action:** ${item.action}`);
    lines.push('');

    if (item.errorMessage) {
      lines.push('<details>');
      lines.push('<summary>Error Details (click to expand)</summary>');
      lines.push('');
      lines.push('```');
      lines.push(item.errorMessage);
      lines.push('```');
      lines.push('</details>');
      lines.push('');
    }

    if (item.healedElements && item.healedElements.length > 0) {
      lines.push('**Healed Elements:**');
      item.healedElements.forEach((h) => {
        lines.push(`- \`${h.elementRef}\` → see screenshot: \`${path.basename(h.screenshotPath)}\``);
      });
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    return lines.join('\n');
  }

  // ─── Private: JSON Report ─────────────────────────────────────────────────

  private _writeJson(
    classifications: Classification[],
    summary: RunSummary
  ): string {
    const filePath = path.join(this.outputDir, 'healing-report.json');

    const report = {
      runDate: summary.runDate,
      summary: {
        total: summary.totalScenarios,
        passed: summary.passed,
        failed: summary.failed,
        skipped: summary.skipped,
        healedElements: summary.healedElements.length,
        appFaults: classifications.filter((c) => c.classification === 'app_fault').length,
        testFaults: classifications.filter((c) => c.classification === 'test_fault').length,
        healed: classifications.filter((c) => c.classification === 'healed').length,
        reviews: classifications.filter((c) => c.classification === 'review').length,
      },
      classifications,
      healedElements: summary.healedElements,
    };

    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`[HealingReportWriter] JSON report: ${filePath}`);
    return filePath;
  }

  // ─── Private: Utilities ───────────────────────────────────────────────────

  private _ensureOutputDir(): void {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }
}
