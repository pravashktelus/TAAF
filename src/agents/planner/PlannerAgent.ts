import { AgentsConfig } from '../config/AgentsConfig';
import { LLMClient } from '../core/LLMClient';
import { PageCrawler } from '../core/PageCrawler';
import { PropertiesRegistry } from '../core/PropertiesRegistry';
import { ContextEnricher } from '../core/ContextEnricher';
import { StoryReader } from './StoryReader';
import { PlanPrompts } from './PlanPrompts';
import { PlanFormatter } from './PlanFormatter';
import * as path from 'path';

/**
 * PlannerAgent
 * ------------
 * CLI entry point for the Planner agent.
 *
 * Usage:
 *   npm run agent:plan -- --story orders-creation.md --page Orders
 *   npm run agent:plan -- --testcases orders-testcases.xlsx --page Orders
 *   npm run agent:plan -- --url https://app.com/orders --page Orders
 *   npm run agent:plan -- --story orders-creation.md --url https://app.com/orders --page Orders
 *   npm run agent:plan -- --story orders.md --page Orders --mode story
 *   npm run agent:plan -- --story orders.md --page Orders --attachments requirements/stories/attachments/sprint5/
 *
 * Output:
 *   generated/plans/{Page}-plan.md   (human-readable — QA reviews this)
 *   generated/plans/{Page}-plan.json (machine-readable — Generator consumes this)
 */

// ─── Parse CLI Arguments ───────────────────────────────────────────────────────

function parseArgs(): {
  story?: string;
  testcases?: string;
  url?: string;
  page?: string;
  mode?: 'story' | 'testcases';
  attachments?: string;
  login?: boolean;
} {
  const args = process.argv.slice(2);
  const result: any = { login: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--story':       result.story = args[++i]; break;
      case '--testcases':   result.testcases = args[++i]; break;
      case '--url':         result.url = args[++i]; break;
      case '--page':        result.page = args[++i]; break;
      case '--mode':        result.mode = args[++i] as 'story' | 'testcases'; break;
      case '--attachments': result.attachments = args[++i]; break;
      case '--login':       result.login = true; break;
    }
  }

  if (!result.story && !result.testcases && !result.url) {
    console.error('[PlannerAgent] ERROR: At least one of --story, --testcases, or --url is required.');
    process.exit(1);
  }

  // Auto-derive --page if not provided
  if (!result.page) {
    if (result.story || result.testcases) {
      // Derive from filename: orders-creation.md → Orders, customer_support.xlsx → CustomerSupport
      const fileName = path.basename(result.story || result.testcases, path.extname(result.story || result.testcases));
      result.page = fileName
        .split(/[-_\s]+/)
        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join('');
    } else if (result.url) {
      // Derive from URL path: /orders → Orders, /customer-support → CustomerSupport
      try {
        const segments = new URL(result.url).pathname.split('/').filter(Boolean);
        const lastSegment = segments[segments.length - 1] || 'Page';
        result.page = lastSegment
          .split(/[-_\s]+/)
          .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join('');
      } catch {
        result.page = 'Page';
      }
    }
    console.log(`[PlannerAgent] --page auto-derived: "${result.page}"`);
  }

  return result;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const config = AgentsConfig.getInstance();

  // Check agents.enabled
  if (!config.enabled) {
    console.warn('[PlannerAgent] Agents are disabled (agents.enabled=false in framework.properties).');
    console.warn('[PlannerAgent] Set agents.enabled=true to use the Planner agent.');
    process.exit(0);
  }

  const args = parseArgs();
  const { url, mode } = args;
  const page = args.page!; // guaranteed by parseArgs auto-derive

  console.log('═══════════════════════════════════════════');
  console.log('  Planner Agent');
  console.log('═══════════════════════════════════════════');
  console.log(`  Page:   ${page}`);
  if (args.story)     console.log(`  Story:  ${args.story}`);
  if (args.testcases) console.log(`  TC File: ${args.testcases}`);
  if (url)            console.log(`  URL:    ${url}`);
  if (mode)           console.log(`  Mode:   ${mode} (forced)`);
  console.log(`  AI:     ${config.aiEnabled ? config.aiProvider : 'disabled (fallback mode)'}`);
  console.log('═══════════════════════════════════════════\n');

  const storyReader = new StoryReader();
  const formatter = new PlanFormatter();
  let crawler: PageCrawler | null = null;

  try {
    // ── Step 1: Read story/testcases input ──────────────────────────────────
    let storyInput = null;

    if (args.story) {
      console.log(`[PlannerAgent] Reading story: ${args.story}`);
      storyInput = await storyReader.readStory(args.story, mode);
    } else if (args.testcases) {
      console.log(`[PlannerAgent] Reading test cases: ${args.testcases}`);
      storyInput = await storyReader.readTestCases(args.testcases);
    }

    const inputMode = storyInput?.mode || 'story';
    console.log(`[PlannerAgent] Input mode: ${inputMode}`);

    if (storyInput?.attachments.length) {
      console.log(`[PlannerAgent] Attachments: ${storyInput.attachments.map((a) => a.fileName).join(', ')}`);
    }

    // ── Step 2: Crawl live page (if URL provided) ───────────────────────────
    let pageSnapshot = undefined;

    if (url) {
      console.log(`[PlannerAgent] Crawling page: ${url}`);
      crawler = new PageCrawler();
      await crawler.launch();

      // Auto-login if requested
      if (args.login) {
        console.log('[PlannerAgent] Auto-login enabled...');
        await crawler.login();
      }

      pageSnapshot = await crawler.crawl(url);

      // Detect login redirect
      const crawledUrl = pageSnapshot.url;
      const isRedirectedToLogin =
        crawledUrl !== url &&
        (crawledUrl.includes('login') || crawledUrl.includes('signin'));

      if (isRedirectedToLogin) {
        console.warn(`[PlannerAgent] ⚠️  Page requires login — redirected to: ${crawledUrl}`);
        console.warn(`[PlannerAgent] ⚠️  Elements will be empty. Use --login flag for authenticated pages.`);
        pageSnapshot.elements = []; // clear — don't use login page elements
      } else {
        console.log(`[PlannerAgent] Discovered ${pageSnapshot.elements.length} elements on page`);
      }

      // ── Step 2a: Match elements against existing properties registry ──────
      const registry = new PropertiesRegistry();
      registry.load();

      let reuseCount = 0;
      let newCount = 0;

      pageSnapshot.elements = pageSnapshot.elements.map((el) => {
        const match = registry.findMatch(el.locator, page, el.key);
        if (match.source === 'existing') {
          reuseCount++;
          return { ...el, source: 'existing', ref: match.ref };
        } else {
          newCount++;
          return { ...el, source: 'new', ref: `${page}.${el.key}` };
        }
      });

      console.log(`[PlannerAgent] Elements: ${reuseCount} reusing existing, ${newCount} new`);
    }

    // ── Step 3: Build prompt + fallback ────────────────────────────────────
    // Enrich AI with existing framework patterns
    const frameworkContext = ContextEnricher.getFullContext(page);
    console.log(`[PlannerAgent] Framework context: ${frameworkContext ? 'loaded' : 'none available'}`);

    let prompt: string;
    let fallback: string;
    let aiResponse: string;

    if (inputMode === 'testcases' && storyInput && storyInput.testCases.length > 0) {
      // ── TESTCASES MODE (structured XLS with standard columns): Skip AI ─────
      console.log(`[PlannerAgent] Testcases mode: using ${storyInput.testCases.length} parsed test case(s) directly (no AI modification)`);

      const directOutput = JSON.stringify({
        page,
        url: pageSnapshot?.url || '',
        mode: 'testcases',
        aiGenerated: false,
        elements: pageSnapshot?.elements || [],
        testCases: storyInput.testCases.map((tc) => ({
          id: tc.id,
          title: tc.title,
          type: 'happy_path',
          navigation: tc.steps.map((s) => s.navigation).filter(Boolean).join(' → ') || '',
          steps: tc.steps,
          edgeCases: [],
        })),
      }, null, 2);

      aiResponse = directOutput;

    } else if (inputMode === 'testcases' && storyInput) {
      // ── TESTCASES MODE (free-form/document-style XLS): AI structures it ────
      // AI's job is ONLY to structure into JSON — NOT modify, split, or skip steps
      prompt = PlanPrompts.buildTestCasesPrompt(storyInput, page, pageSnapshot, frameworkContext);
      fallback = PlanPrompts.buildTestCasesFallback(page, storyInput, pageSnapshot);

      console.log(`[PlannerAgent] Sending to ${config.aiEnabled ? config.aiProvider : 'fallback'}...`);
      aiResponse = await LLMClient.askWithSystem(PlanPrompts.SYSTEM_PROMPT, prompt, fallback);

    } else if (storyInput) {
      // Story mode — try deterministic AC extraction FIRST, only use AI if no ACs found
      const parsedACs = PlanPrompts._parseAcceptanceCriteria(storyInput.mainContent);

      if (parsedACs.length > 0) {
        // ── STORY MODE with explicit ACs: Use them directly (no AI hallucination) ──
        console.log(`[PlannerAgent] Found ${parsedACs.length} acceptance criteria — using directly (no AI modification)`);

        const directOutput = JSON.stringify({
          page,
          url: pageSnapshot?.url || '',
          mode: 'story',
          aiGenerated: false,
          elements: pageSnapshot?.elements || [],
          testCases: parsedACs.map((ac, index) => ({
            id: `TC-${String(index + 1).padStart(3, '0')}`,
            title: ac.title,
            type: index === 0 ? 'happy_path' : (
              ac.title.toLowerCase().match(/negative|invalid|incorrect|without|unauthorized|empty/)
                ? 'negative' : 'happy_path'
            ),
            navigation: '',
            steps: ac.steps.map((step, si) => ({
              stepNo: si + 1,
              action: step.action,
              navigation: '',
              testData: step.testData,
              expected: step.expected,
            })),
            edgeCases: [],
          })),
        }, null, 2);

        aiResponse = directOutput;
      } else {
        // No parseable ACs — fall back to AI generation
        console.log(`[PlannerAgent] No explicit ACs found — using AI to generate test cases`);
        prompt = PlanPrompts.buildStoryPrompt(storyInput, page, pageSnapshot, frameworkContext);
        fallback = PlanPrompts.buildStoryFallback(page, pageSnapshot, storyInput.mainContent);

        console.log(`[PlannerAgent] Sending to ${config.aiEnabled ? config.aiProvider : 'fallback'}...`);
        aiResponse = await LLMClient.askWithSystem(PlanPrompts.SYSTEM_PROMPT, prompt, fallback);
      }

    } else {
      // URL only — story mode with no input file
      prompt = PlanPrompts.buildStoryPrompt(
        { mode: 'story', mainContent: '', testCases: [], attachments: [], sourcePath: '', sourceFileName: '' },
        page,
        pageSnapshot,
        frameworkContext
      );
      fallback = PlanPrompts.buildStoryFallback(page, pageSnapshot, '');

      console.log(`[PlannerAgent] Sending to ${config.aiEnabled ? config.aiProvider : 'fallback'}...`);
      aiResponse = await LLMClient.askWithSystem(PlanPrompts.SYSTEM_PROMPT, prompt, fallback);
    }

    const isAIResponse = aiResponse.includes('"aiGenerated": true') || aiResponse.includes('"aiGenerated":true');
    console.log(`[PlannerAgent] Response ready (${isAIResponse ? 'AI-generated' : 'direct/fallback'})`);

    // ── Step 5: Format and write output files ───────────────────────────────
    const sourceFile = args.story || args.testcases || url || 'unknown';
    const { mdPath, jsonPath } = formatter.format(aiResponse, page, sourceFile);

    // ── Done ────────────────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════');
    console.log('  Planner Agent — Complete');
    console.log('═══════════════════════════════════════════');
    console.log(`  Markdown plan:  ${mdPath}`);
    console.log(`  JSON plan:      ${jsonPath}`);
    console.log('');
    console.log('  Next step: Review the Markdown plan, then run:');
    console.log(`  npm run agent:generate -- --plan generated/plans/${page}-plan.json`);
    console.log('═══════════════════════════════════════════\n');

  } finally {
    // Always close browser
    if (crawler) await crawler.close();
  }
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
run().catch((err) => {
  console.error('[PlannerAgent] Fatal error:', err);
  process.exit(1);
});
