import { AgentsConfig } from '../config/AgentsConfig';
import { ReportReader } from './ReportReader';
import { FailureClassifier } from './FailureClassifier';
import { HealingReportWriter } from './HealingReportWriter';

/**
 * HealerAgent
 * -----------
 * CLI entry point for the Healer agent.
 *
 * Reads test run reports, classifies each failure as:
 *   - app_fault  → real bug → raise defect
 *   - test_fault → stale locator/step → update test
 *   - healed     → self-healed at runtime → persist locator fix
 *   - review     → ambiguous → investigate manually
 *
 * Usage:
 *   npm run agent:heal
 *   npm run agent:heal -- --report reports/cucumber-json/cucumber-report.json
 *   npm run agent:heal -- --ai    (enable AI for ambiguous cases)
 *
 * Output:
 *   generated/reports/healing-report.md   (human-readable — open this)
 *   generated/reports/healing-report.json (structured data)
 */

// ─── Parse CLI Arguments ──────────────────────────────────────────────────────

function parseArgs(): { report?: string; ai: boolean } {
  const args = process.argv.slice(2);
  const result: { report?: string; ai: boolean } = { ai: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--report': result.report = args[++i]; break;
      case '--ai':     result.ai = true; break;
    }
  }

  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const config = AgentsConfig.getInstance();

  if (!config.enabled) {
    console.warn('[HealerAgent] Agents disabled (agents.enabled=false). Set to true to use.');
    process.exit(0);
  }

  const args = parseArgs();

  console.log('═══════════════════════════════════════════');
  console.log('  Healer Agent');
  console.log('═══════════════════════════════════════════');
  if (args.report) console.log(`  Report: ${args.report}`);
  else             console.log(`  Report: reports/cucumber-json/cucumber-report.json (default)`);
  console.log(`  AI:     ${args.ai && config.aiEnabled ? config.aiProvider + ' (for ambiguous cases)' : 'disabled (rule-based only)'}`);
  console.log('═══════════════════════════════════════════\n');

  // ── Step 1: Read reports ───────────────────────────────────────────────────
  const reader = new ReportReader();
  let summary;

  try {
    summary = reader.read(args.report);
  } catch (error) {
    console.error(`[HealerAgent] ${error}`);
    process.exit(1);
  }

  if (summary.totalScenarios === 0) {
    console.warn('[HealerAgent] No scenarios found in report. Run npm test first.');
    process.exit(0);
  }

  // ── Step 2: Classify all scenarios ────────────────────────────────────────
  console.log(`\n[HealerAgent] Classifying ${summary.totalScenarios} scenario(s)...`);
  const classifier = new FailureClassifier();
  const classifications = await classifier.classifyAll(summary);

  // Print quick console summary
  const appFaults = classifications.filter((c) => c.classification === 'app_fault').length;
  const testFaults = classifications.filter((c) => c.classification === 'test_fault').length;
  const healed = classifications.filter((c) => c.classification === 'healed').length;
  const reviews = classifications.filter((c) => c.classification === 'review').length;

  console.log(`\n[HealerAgent] Classification Results:`);
  if (appFaults > 0)  console.log(`  🐛 App Bugs:     ${appFaults} (raise defects)`);
  if (testFaults > 0) console.log(`  🔧 Test Issues:  ${testFaults} (update locators/steps)`);
  if (healed > 0)     console.log(`  ✨ Self-Healed:  ${healed} (persist locator fixes)`);
  if (reviews > 0)    console.log(`  👁️  Need Review: ${reviews} (investigate manually)`);
  if (appFaults === 0 && testFaults === 0 && healed === 0 && reviews === 0) {
    console.log(`  ✅ All passed — no action needed!`);
  }

  // ── Step 3: Write healing reports ─────────────────────────────────────────
  console.log(`\n[HealerAgent] Writing healing reports...`);
  const writer = new HealingReportWriter();
  const { mdPath, jsonPath } = writer.write(classifications, summary);

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════');
  console.log('  Healer Agent — Complete');
  console.log('═══════════════════════════════════════════');
  console.log(`  Healing report: ${mdPath}`);
  console.log(`  JSON report:    ${jsonPath}`);
  console.log('');
  console.log('  Open the healing report to see:');
  console.log('  - Which failures are real bugs vs stale tests');
  console.log('  - Exactly which .properties files to update');
  console.log('  - Self-healed elements that need locator persistence');
  console.log('═══════════════════════════════════════════\n');
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
run().catch((err) => {
  console.error('[HealerAgent] Fatal error:', err);
  process.exit(1);
});
