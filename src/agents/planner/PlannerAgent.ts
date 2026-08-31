import { AgentsConfig } from '../config/AgentsConfig';
import { LLMClient } from '../core/LLMClient';
import { PlaywrightCrawler } from '../core/PlaywrightCrawler';
import { PageCrawler } from '../core/PageCrawler';
import { PropertiesRegistry } from '../core/PropertiesRegistry';
import { ContextEnricher } from '../core/ContextEnricher';
import { SourceIndexProvider } from '../core/SourceIndexProvider';
import { StoryReader } from './StoryReader';
import { PlanPrompts } from './PlanPrompts';
import { PlanFormatter } from './PlanFormatter';
import { FrameworkConfig } from '../../config/FrameworkConfig';
import * as fs from 'fs';
import * as path from 'path';

/**
 * PlannerAgent
 * ------------
 * CLI entry point for the Planner agent.
 *
 * Usage:
 *   # Single story
 *   npm run agent:plan -- --story orders-creation.md --page Orders
 *   npm run agent:plan -- --story orders-creation.md --url https://app.com/orders --page Orders
 *
 *   # Multiple stories (processed sequentially)
 *   npm run agent:plan -- --story story1.md --story story2.md --story story3.md
 *   npm run agent:plan -- --story story1.md --story story2.md --url https://app.com/
 *
 *   # Other modes
 *   npm run agent:plan -- --testcases orders-testcases.xlsx --page Orders
 *   npm run agent:plan -- --url https://app.com/orders --page Orders
 *   npm run agent:plan -- --story orders.md --page Orders --mode story
 *   npm run agent:plan -- --story orders.md --page Orders --attachments requirements/stories/attachments/sprint5/
 *
 * Output:
 *   generated/plans/{Page}-plan.md   (human-readable — QA reviews this)
 *   generated/plans/{Page}-plan.json (machine-readable — Generator consumes this)
 */

// ─── Parse CLI Arguments ───────────────────────────────────────────────────────

interface PlannerArgs {
  stories: string[];
  testcases?: string;
  url?: string;
  page?: string;
  mode?: 'story' | 'testcases';
  attachments?: string;
  login: boolean;
}

function parseArgs(): PlannerArgs {
  const args = process.argv.slice(2);
  const result: PlannerArgs = { stories: [], login: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--story':       result.stories.push(args[++i]); break;
      case '--testcases':   result.testcases = args[++i]; break;
      case '--url':         result.url = args[++i]; break;
      case '--page':        result.page = args[++i]; break;
      case '--mode':        result.mode = args[++i] as 'story' | 'testcases'; break;
      case '--attachments': result.attachments = args[++i]; break;
      case '--login':       result.login = true; break;
    }
  }

  if (result.stories.length === 0 && !result.testcases && !result.url) {
    console.error('[PlannerAgent] ERROR: At least one of --story, --testcases, or --url is required.');
    process.exit(1);
  }

  return result;
}

/**
 * Auto-derive the --page name from a story file, testcases file, or URL.
 */
function derivePage(storyFile?: string, testcasesFile?: string, url?: string, explicitPage?: string): string {
  // 1. Explicit --page always wins.
  if (explicitPage) return explicitPage;

  // 2. Try to resolve a KNOWN page (existing .properties or source-repo pageMap)
  //    from signals in the story content and URL. This prevents deriving a bogus
  //    page name from the story filename (e.g. "TeleconnectOrderplacementStory"),
  //    which would starve the plan of registry/source elements and produce
  //    force-fit garbage.
  const resolved = _resolveKnownPage(storyFile, url);
  if (resolved) {
    console.log(`[PlannerAgent] --page resolved to known page: "${resolved}" (matched registry/source).`);
    return resolved;
  }

  // 3. Fall back to filename-derived name (new/unknown page).
  if (storyFile || testcasesFile) {
    const fileName = path.basename(storyFile || testcasesFile!, path.extname(storyFile || testcasesFile!));
    const derived = fileName
      .split(/[-_\s]+/)
      .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
    console.log(`[PlannerAgent] --page auto-derived from filename: "${derived}" (no known page matched — pass --page to override).`);
    return derived;
  }

  if (url) {
    try {
      const segments = new URL(url).pathname.split('/').filter(Boolean);
      const lastSegment = segments[segments.length - 1] || 'Page';
      const derived = lastSegment
        .split(/[-_\s]+/)
        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join('');
      console.log(`[PlannerAgent] --page auto-derived from URL: "${derived}".`);
      return derived;
    } catch {
      return 'Page';
    }
  }

  return 'Page';
}

/**
 * Resolves a KNOWN framework page name using signals from the story content and
 * URL, matched against:
 *   • existing .properties page names (the curated registry), and
 *   • the source-repo route→page map (agents.appRepo.pageMap).
 *
 * Returns the matched page name, or '' if nothing matches. Read-only + safe:
 * any failure just returns '' so the caller falls back to filename derivation.
 */
function _resolveKnownPage(storyFile?: string, url?: string): string {
  try {
    // Gather searchable text: story content + explicit Page/URL lines + url arg.
    let hay = (url || '').toLowerCase();
    if (storyFile && fs.existsSync(storyFile)) {
      hay += ' ' + fs.readFileSync(storyFile, 'utf-8').toLowerCase();
    }
    if (!hay.trim()) return '';

    // (0) Highest confidence: the story explicitly declares its page/module via a
    //     "Page Name:" / "Page:" (non-URL) metadata line. This is the reliable,
    //     no-guess signal — author states it once and it always wins.
    const declaredMatch = hay.match(/(?:^|\n)\s*\*{0,2}page\s*name\*{0,2}\s*:\s*([a-z0-9_-]+)/i)
      || hay.match(/(?:^|\n)\s*\*{0,2}page\*{0,2}\s*:\s*([a-z][a-z0-9_-]{2,})\s*(?:\n|$)/i);
    if (declaredMatch && declaredMatch[1] && !/^https?/i.test(declaredMatch[1])) {
      // Normalize to the registry's casing if it exists, else use as-declared (PascalCase).
      const declared = declaredMatch[1].trim();
      try {
        const reg = new PropertiesRegistry();
        reg.load();
        const known = reg.getPageNames().find((n) => n.toLowerCase() === declared.toLowerCase());
        if (known) return known;
      } catch { /* fall through */ }
      return declared.charAt(0).toUpperCase() + declared.slice(1);
    }

    // Generic page/module names that appear in almost any story ("login" is in
    // every app) — never resolve to these; they cause false matches.
    const GENERIC_PAGES = new Set([
      'login', 'home', 'cart', 'checkout', 'signup', 'register', 'dashboard',
      'page', 'account', 'profile', 'search', 'settings',
    ]);

    // (a) Match against existing .properties page names FIRST — most reliable.
    //     Stories name their page/module explicitly (e.g. the title/subject
    //     mentions "TeleCRM", "TeleConnect", "AutomationExercise"). We match on
    //     the story TITLE/first lines (strong signal) and skip generic names.
    const titleHay = hay.split('\n').slice(0, 6).join(' '); // title + subject region
    const registry = new PropertiesRegistry();
    registry.load();
    const pageNames = registry.getPageNames().sort((a, b) => b.length - a.length);
    // Pass 1: distinctive name found in the title/first lines.
    for (const name of pageNames) {
      if (name.length >= 5 && !GENERIC_PAGES.has(name.toLowerCase()) && titleHay.includes(name.toLowerCase())) {
        return name;
      }
    }
    // Pass 2: distinctive name found anywhere in the story.
    for (const name of pageNames) {
      if (name.length >= 5 && !GENERIC_PAGES.has(name.toLowerCase()) && hay.includes(name.toLowerCase())) {
        return name;
      }
    }

    // (b) Fall back to the source-repo pageMap, for DISTINCTIVE routes only.
    //     Generic single-segment routes like "/login" or "/register" collide
    //     across unrelated apps (every app has a /login), so skip them. For the
    //     remaining app-specific routes (e.g. "/customer", "/crm", "/customer/order")
    //     we match either the full route path OR its distinctive last segment as
    //     a whole word (so "Verify the URL contains 'customer'" matches /customer).
    const config = FrameworkConfig.getInstance();
    const rawMap = config.get('agents.appRepo.pageMap', '');
    const GENERIC_ROUTES = new Set(['/login', '/register', '/signup', '/signin', '/home', '/', '/auth']);
    const routePairs = rawMap
      .split(',')
      .map((p) => p.split('=').map((s) => s.trim()))
      .filter((kv) => kv.length === 2 && kv[0] && kv[1]) as [string, string][];
    // Longest route first (most specific wins, e.g. /customer/order before /customer).
    routePairs.sort((a, b) => b[0].length - a[0].length);
    // Only accept a FULL route-path match (e.g. the story literally contains
    // "/customer/order" or "/crm"). Bare-word segment matching ("orders",
    // "installation", "customer") is deliberately NOT used — those words appear
    // in prose across stories for different pages and cause wrong resolution.
    // When the signal is ambiguous we return '' and let the caller fall back to
    // the filename; the Generator's elements=0 guardrail then prompts for an
    // explicit --page. Reliability over cleverness.
    for (const [route, pageName] of routePairs) {
      if (GENERIC_ROUTES.has(route.toLowerCase())) continue; // too generic — skip
      if (hay.includes(route.toLowerCase())) return pageName; // full path only
    }

    return '';
  } catch {
    return '';
  }
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

  // If multiple stories provided, process each sequentially
  if (args.stories.length > 1) {
    console.log('═══════════════════════════════════════════');
    console.log('  Planner Agent — Batch Mode');
    console.log(`  Processing ${args.stories.length} stories sequentially`);
    console.log('═══════════════════════════════════════════\n');

    const results: { story: string; page: string; mdPath: string; jsonPath: string }[] = [];

    for (let i = 0; i < args.stories.length; i++) {
      const storyFile = args.stories[i];
      const page = derivePage(storyFile, undefined, args.url, args.page);
      console.log(`\n┌─── Story ${i + 1}/${args.stories.length}: ${storyFile} ───┐\n`);

      try {
        const { mdPath, jsonPath } = await runSinglePlan({
          story: storyFile,
          url: args.url,
          page,
          mode: args.mode,
          attachments: args.attachments,
          login: args.login,
        });
        results.push({ story: storyFile, page, mdPath, jsonPath });
        console.log(`└─── Story ${i + 1} complete ───┘\n`);
      } catch (err) {
        console.error(`[PlannerAgent] ❌ Failed processing story: ${storyFile}`);
        console.error(`  Error: ${err}`);
        console.log(`└─── Story ${i + 1} FAILED ───┘\n`);
      }
    }

    // Summary
    console.log('\n═══════════════════════════════════════════');
    console.log('  Planner Agent — Batch Complete');
    console.log('═══════════════════════════════════════════');
    console.log(`  Processed: ${results.length}/${args.stories.length} stories`);
    results.forEach((r, i) => {
      console.log(`\n  [${i + 1}] ${r.story}`);
      console.log(`      Page:     ${r.page}`);
      console.log(`      Plan MD:  ${r.mdPath}`);
      console.log(`      Plan JSON: ${r.jsonPath}`);
    });
    console.log('\n  Next step: Generate features for all plans:');
    const planFlags = results.map((r) => `--plan "${r.jsonPath}"`).join(' ');
    console.log(`  npm run agent:generate -- ${planFlags}`);
    console.log('═══════════════════════════════════════════\n');
    return;
  }

  // Single story / testcases / url — original flow
  const storyFile = args.stories[0]; // may be undefined if --testcases or --url only
  const page = derivePage(storyFile, args.testcases, args.url, args.page);

  const { mdPath, jsonPath } = await runSinglePlan({
    story: storyFile,
    testcases: args.testcases,
    url: args.url,
    page,
    mode: args.mode,
    attachments: args.attachments,
    login: args.login,
  });

  console.log('\n═══════════════════════════════════════════');
  console.log('  Planner Agent — Complete');
  console.log('═══════════════════════════════════════════');
  console.log(`  Markdown plan:  ${mdPath}`);
  console.log(`  JSON plan:      ${jsonPath}`);
  console.log('');
  console.log('  Next step: Review the Markdown plan, then run:');
  console.log(`  npm run agent:generate -- --plan generated/plans/${page}-plan.json`);
  LLMClient.printTokenUsage();
  console.log('═══════════════════════════════════════════\n');
}

// ─── Single Plan Execution ────────────────────────────────────────────────────

interface SinglePlanArgs {
  story?: string;
  testcases?: string;
  url?: string;
  page: string;
  mode?: 'story' | 'testcases';
  attachments?: string;
  login: boolean;
}

async function runSinglePlan(args: SinglePlanArgs): Promise<{ mdPath: string; jsonPath: string }> {
  const config = AgentsConfig.getInstance();
  const { url, mode, page } = args;

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
  let crawler: PlaywrightCrawler | null = null;

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

    // ── Story Validation: detect ambiguities and missing info ──────────────
    const validationWarnings = _validateStory(storyInput?.mainContent || '', url, inputMode);
    if (validationWarnings.length > 0) {
      console.warn(`[PlannerAgent] ⚠️  Story validation found ${validationWarnings.length} issue(s):`);
      validationWarnings.forEach((w) => console.warn(`    - ${w}`));
    }

    // ── Step 2: Crawl live page by replaying story steps ────────
    let pageSnapshot = undefined;

    if (url) {
      console.log(`[PlannerAgent] Crawling via step replay...`);
      crawler = new PlaywrightCrawler();
      await crawler.launch();

      // Auto-login if requested
      if (args.login) {
        console.log('[PlannerAgent] Auto-login enabled...');
        await crawler.login();
      }

      // Extract steps from the story content to replay through the app
      const storySteps = _extractStoryStepsForReplay(storyInput?.mainContent || '');

      if (storySteps.length > 0) {
        // Replay story steps — navigate through the actual flow, snapshot at each page
        console.log(`[PlannerAgent] Replaying ${storySteps.length} story steps to discover all pages...`);
        const appUrl = url.includes('/auth/') || url.includes('/login')
          ? url.replace(/\/auth\/.*/, '/').replace(/\/login.*/, '/')
          : url;

        const replaySnapshots = await crawler.replaySteps(storySteps, appUrl);

        // Merge all snapshots into one combined snapshot
        if (replaySnapshots.length > 0) {
          pageSnapshot = replaySnapshots[replaySnapshots.length - 1]; // Use final page as base
          // Merge elements from earlier pages
          for (let i = 0; i < replaySnapshots.length - 1; i++) {
            replaySnapshots[i].elements.forEach((el: any) => {
              if (!pageSnapshot!.elements.some((e: any) => e.locator === el.locator)) {
                pageSnapshot!.elements.push(el);
              }
            });
          }
          console.log(`[PlannerAgent] Step replay: ${replaySnapshots.length} pages visited, ${pageSnapshot.elements.length} total elements`);
          
          // AI-driven crawl disabled — too expensive. Fix step extraction instead.
          // if (pageSnapshot.elements.length < 15 && config.aiEnabled) { ... }
        } else {
          // Replay produced no snapshots — fall back to direct crawl
          console.log(`[PlannerAgent] Step replay produced no results — falling back to direct crawl: ${url}`);
          pageSnapshot = await crawler.crawl(url);
        }
      } else {
        // No steps extracted from story — crawl URL directly
        console.log(`[PlannerAgent] No replayable steps found in story — crawling URL directly: ${url}`);
        pageSnapshot = await crawler.crawl(url);
      }

      // Detect login redirect
      const crawledUrl = pageSnapshot.url;
      const isRedirectedToLogin =
        crawledUrl !== url &&
        (crawledUrl.includes('login') || crawledUrl.includes('signin'));

      if (isRedirectedToLogin) {
        console.warn(`[PlannerAgent] ⚠️  Page requires login — redirected to: ${crawledUrl}`);
        console.warn(`[PlannerAgent] ⚠️  Elements will be empty. Use --login flag for authenticated pages.`);
        pageSnapshot.elements = [];
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

      // ── Step 2b: Smart hybrid — curated registry is authoritative ─────────
      // When a hand-verified .properties file already exists for this page, it
      // is the source of truth. A live crawl of a real site returns a lot of
      // NOISE — nav menus, footer/brand links, ads, unrelated products — which,
      // if merged in, dilutes the clean set and the AI ends up binding steps to
      // junk elements. So:
      //   • If the page HAS a curated .properties: use ONLY registry elements
      //     (drop crawl-discovered "new" noise). The crawl still confirmed the
      //     page is reachable; its verified matches are already in the registry.
      //   • If the page has NO .properties: keep the crawl as-is (new page).
      const registeredForPage = registry.getPageElements(page);
      if (registeredForPage.length > 0) {
        const droppedNoise = pageSnapshot.elements.filter((e: any) => e.source === 'new').length;

        // Replace the snapshot's element set with the curated registry elements.
        pageSnapshot.elements = registeredForPage.map((reg) => ({
          key: reg.elementKey,
          locator: reg.locator,
          type: _inferElementType(reg.elementKey, reg.locator),
          label: _humanizeKey(reg.elementKey),
          tag: '',
          source: 'existing',
          ref: reg.ref,
        })) as any;

        console.log(
          `[PlannerAgent] Curated registry authoritative for '${page}': using ` +
          `${registeredForPage.length} verified element(s); dropped ${droppedNoise} ` +
          `crawl-discovered noise element(s).`
        );
      }

      // ── Step 2c: Merge authoritative locators from the app SOURCE repo ─────
      // The dev repo's source (data-testid in .tsx) is a complete, authoritative
      // locator source — it covers pages the crawler can't reach AND error
      // elements the curated .properties often lacks (e.g. error-customerName).
      // Precedence: curated registry key wins on conflict; source ADDS anything
      // the registry is missing. This is how, e.g., the ErrorCustomerName element
      // becomes available for honest negative-case assertions.
      const sourceProvider = new SourceIndexProvider();
      if (sourceProvider.isAvailable()) {
        const sourceLocators = sourceProvider.getLocatorsForPage(page);
        if (sourceLocators.length > 0) {
          const existingKeys = new Set(
            pageSnapshot.elements.map((e: any) => (e.key || '').toLowerCase())
          );
          let addedFromSource = 0;
          for (const sl of sourceLocators) {
            if (existingKeys.has(sl.key.toLowerCase())) continue; // registry wins
            pageSnapshot.elements.push({
              key: sl.key,
              locator: sl.locator,
              type: _inferElementType(sl.key, sl.locator),
              label: _humanizeKey(sl.key),
              tag: '',
              source: 'source-repo',
              ref: `${page}.${sl.key}`,
            } as any);
            existingKeys.add(sl.key.toLowerCase());
            addedFromSource++;
          }
          console.log(
            `[PlannerAgent] Source repo: added ${addedFromSource} authoritative ` +
            `element(s) from app source (total now ${pageSnapshot.elements.length}).`
          );

          // Attach source validations to the plan for honest negative-case generation.
          const sourceValidations = sourceProvider.getValidationsForPage(page);
          if (sourceValidations.length > 0) {
            (pageSnapshot as any).sourceValidations = sourceValidations;
            console.log(
              `[PlannerAgent] Source repo: ${sourceValidations.length} validation rule(s) ` +
              `available for negative cases (real messages, no guessing).`
            );
          }
        }
      }
    }

    // ── Step 3: Build prompt + fallback ────────────────────────────────────
    // Enrich AI with existing framework patterns.
    // Relevance hint (page + story content + URL) drives selective domain
    // knowledge — telecom knowledge loads only for telecom stories.
    const relevanceHint = [page, storyInput?.mainContent || '', url || '']
      .join(' ')
      .slice(0, 4000);
    const frameworkContext = ContextEnricher.getFullContext(page, relevanceHint);
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

        // Extract Application URL and Navigation Flow from story
        const storyUrl = _extractStoryField(storyInput.mainContent, 'Application URL') || pageSnapshot?.url || '';
        const navFlow = _extractStoryField(storyInput.mainContent, 'Navigation Flow') || '';
        if (storyUrl) console.log(`[PlannerAgent] Application URL from story: ${storyUrl}`);
        if (navFlow) console.log(`[PlannerAgent] Navigation Flow: ${navFlow}`);

        // Extract Test Data section from story
        const testDataMap = _extractTestDataFromStory(storyInput.mainContent);
        if (Object.keys(testDataMap).length > 0) {
          console.log(`[PlannerAgent] Test data extracted: ${Object.keys(testDataMap).length} fields`);
        }

        // ── Prefer granular Detailed Steps for the happy-path scenario ──────
        // ACs are high-level summaries ("complete all 6 steps"); the Detailed
        // Steps section is the authoritative field-by-field flow. When present,
        // use it as the happy-path test case so the generated feature is granular.
        const detailedTC = PlanPrompts._parseDetailedStepsAsTestCase(storyInput.mainContent);
        if (detailedTC) {
          console.log(`[PlannerAgent] Using Detailed Steps for happy-path scenario (${detailedTC.steps.length} steps) — ACs kept for negative/edge cases`);
          parsedACs[0] = detailedTC;
        }

        const directOutput = JSON.stringify({
          page,
          url: storyUrl,
          navigationFlow: navFlow,
          mode: 'story',
          aiGenerated: false,
          testData: testDataMap,
          elements: pageSnapshot?.elements || [],
          testCases: parsedACs.map((ac, index) => ({
            id: `TC-${String(index + 1).padStart(3, '0')}`,
            title: ac.title,
            type: index === 0 ? 'happy_path' : (
              ac.title.toLowerCase().match(/negative|invalid|incorrect|without|unauthorized|empty/)
                ? 'negative' : 'happy_path'
            ),
            navigation: navFlow,
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

        // ── Supplementary AI call: Generate negative/edge cases based on user ACs ──
        if (config.aiEnabled) {
          console.log(`[PlannerAgent] Generating supplementary negative/edge test cases via AI...`);
          const supplementaryPrompt = PlanPrompts.buildSupplementaryPrompt(
            parsedACs,
            page,
            storyInput.mainContent,
            testDataMap,
            (pageSnapshot as any)?.sourceValidations || []
          );
          const supplementaryFallback = '[]'; // empty array if AI fails

          try {
            const supplementaryResponse = await LLMClient.askWithSystem(
              PlanPrompts.SUPPLEMENTARY_SYSTEM_PROMPT,
              supplementaryPrompt,
              supplementaryFallback
            );

            // Parse supplementary test cases and merge into the plan
            const parsed = JSON.parse(directOutput);
            let additionalCases: any[] = [];

            try {
              // AI may return a JSON array or an object with testCases array
              const aiResult = JSON.parse(supplementaryResponse);
              additionalCases = Array.isArray(aiResult) ? aiResult : (aiResult.testCases || []);
            } catch {
              console.warn(`[PlannerAgent] Could not parse supplementary AI response — skipping`);
            }

            if (additionalCases.length > 0) {
              const existingCount = parsed.testCases.length;
              additionalCases.forEach((tc: any, idx: number) => {
                parsed.testCases.push({
                  id: `TC-${String(existingCount + idx + 1).padStart(3, '0')}`,
                  title: tc.title || `Negative/Edge Case ${idx + 1}`,
                  type: tc.type || 'negative',
                  navigation: navFlow,
                  steps: (tc.steps || []).map((s: any, si: number) => ({
                    stepNo: si + 1,
                    action: s.action || '',
                    navigation: s.navigation || '',
                    testData: s.testData || '',
                    expected: s.expected || '',
                  })),
                  edgeCases: [],
                });
              });
              console.log(`[PlannerAgent] Added ${additionalCases.length} supplementary test case(s) (negative/edge)`);
              aiResponse = JSON.stringify(parsed, null, 2);
            } else {
              console.log(`[PlannerAgent] No supplementary cases generated`);
            }
          } catch (err) {
            console.warn(`[PlannerAgent] Supplementary AI call failed: ${err}. Continuing with user ACs only.`);
          }
        }
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

    // ── Step 4b: Ensure crawled elements are preserved (never trust AI-generated elements) ──
    // The AI may modify element keys/locators/casing when it produces the JSON.
    // Always override with the original crawled elements from pageSnapshot.
    if (pageSnapshot && pageSnapshot.elements.length > 0 && isAIResponse) {
      try {
        const parsed = JSON.parse(
          aiResponse.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
        );
        parsed.elements = pageSnapshot.elements;
        aiResponse = JSON.stringify(parsed, null, 2);
        console.log(`[PlannerAgent] Injected ${pageSnapshot.elements.length} crawled elements into AI response (overriding AI-generated elements)`);
      } catch {
        // If parsing fails, the formatter will handle it
        console.warn(`[PlannerAgent] Could not inject crawled elements into AI response — formatter will handle`);
      }
    }

    // ── Step 5: Build analysis metadata (assumptions + warnings) ────────────
    const analysis = _buildAnalysis(storyInput?.mainContent || '', url, inputMode, pageSnapshot, validationWarnings);

    // ── Step 6: Format and write output files ───────────────────────────────
    const sourceFile = args.story || args.testcases || url || 'unknown';
    const { mdPath, jsonPath } = formatter.format(aiResponse, page, sourceFile, analysis);

    return { mdPath, jsonPath };

  } finally {
    // Always close browser
    if (crawler) await crawler.close();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
/**
 * Validates a story for ambiguities and missing information.
 * Returns a list of warning strings (empty if story is complete).
 */
function _validateStory(content: string, url: string | undefined, mode: string): string[] {
  const warnings: string[] = [];
  const lower = content.toLowerCase();
  const isApi = mode === 'api' || /send a (?:get|post|put|patch|delete) request|response status/i.test(content);

  // 1. Missing URL (web stories need it for crawling)
  if (!isApi && !url && !/application url|https?:\/\//i.test(content)) {
    warnings.push('No application URL provided (--url or "Application URL" in story). Crawler cannot discover live elements.');
  }

  // 2. Missing acceptance criteria / detailed steps
  if (!/acceptance criteria|detailed steps|## ac|ac-\d/i.test(content)) {
    warnings.push('No "Acceptance Criteria" or "Detailed Steps" section found. Test cases may be incomplete.');
  }

  // 3. Vague step language (web stories) — "fill the form" without field details
  if (!isApi) {
    const vaguePatterns = [
      /fill (?:the |in the |out the )?(?:form|details|information)(?!\s+(?:with|like|:))/i,
      /enter (?:the )?(?:required|necessary|appropriate) (?:details|fields|information)/i,
      /complete (?:the )?(?:form|registration|steps)(?!\s+(?:with|by|:))/i,
    ];
    if (vaguePatterns.some((p) => p.test(content))) {
      warnings.push('Story contains vague steps (e.g., "fill the form" without specific fields). Add explicit field-by-field steps for accurate generation.');
    }
  }

  // 4. Missing expected results / verification steps
  if (!/verify|should|expected|assert|confirm/i.test(content)) {
    warnings.push('No verification/expected-result language found. Scenarios may lack assertions.');
  }

  // 5. Credentials referenced but not defined
  if (/\$\$/.test(content) && !/runtime-store|persist|store/i.test(content)) {
    warnings.push('Story references $$variables but no scenario persists them. Ensure a prior scenario stores these values.');
  }

  return warnings;
}

/**
 * Builds the Analysis & Assumptions metadata for the plan output.
 * Documents what the agent detected, assumed, and flagged.
 */
function _buildAnalysis(
  content: string,
  url: string | undefined,
  mode: string,
  pageSnapshot: any,
  warnings: string[]
): { detected: string[]; assumptions: string[]; warnings: string[]; dependencies: string[] } {
  const detected: string[] = [];
  const assumptions: string[] = [];
  const dependencies: string[] = [];
  const isApi = mode === 'api' || /send a (?:get|post|put|patch|delete) request|response status/i.test(content);

  // Detected characteristics
  if (isApi) {
    detected.push('API test flow (REST endpoints)');
  } else {
    detected.push('Web UI test flow');
  }
  if (/register|sign ?up|create an account/i.test(content)) detected.push('Registration/account creation flow');
  if (/login|sign ?in/i.test(content)) detected.push('Authentication/login flow');
  if (/step \d|wizard|multi-step/i.test(content)) detected.push('Multi-step wizard flow');
  if (/cart|checkout|add to cart/i.test(content)) detected.push('E-commerce cart flow');
  if (pageSnapshot?.elements?.length) detected.push(`${pageSnapshot.elements.length} live elements captured from crawl`);

  // Assumptions
  if (/##(?:FullName|Email|Password|FirstName|LastName|MobileNum)/i.test(content) || /random/i.test(content)) {
    assumptions.push('Random test data (##tokens) used for name/email/phone — unique per run via Faker.js');
  }
  if (/\$\$/.test(content)) {
    assumptions.push('Cross-scenario variables ($$) resolved from testdata/runtime-store.json');
  }
  if (!isApi) {
    assumptions.push('Each scenario runs in a fresh browser session (no shared state)');
  }
  if (/negative|edge/i.test(content) || true) {
    assumptions.push('Supplementary negative/edge test cases generated by AI based on happy path');
  }

  // Dependencies
  if (/login|sign ?in/i.test(content) && /\$\$(?:email|password|username)/i.test(content)) {
    dependencies.push('Requires persisted credentials in testdata/runtime-store.json from a prior registration scenario');
  }
  if (isApi) {
    dependencies.push('Requires API base URL to be reachable');
  } else if (url) {
    dependencies.push(`Requires application to be accessible at: ${url}`);
  }
  if (/\$\$OrderId|\$\$TicketId/i.test(content)) {
    dependencies.push('Depends on an ID captured by a preceding scenario (cross-scenario chain)');
  }

  return { detected, assumptions, warnings, dependencies };
}

/**
 * Extracts a named field value from story content.
 * e.g. "Application URL" → "https://automationexercise.com"
 * e.g. "Navigation Flow" → "Home → Login → Products → Cart"
 */
function _extractStoryField(content: string, fieldName: string): string {
  // Match patterns like "## Application URL\nhttps://..." or "Application URL: https://..."
  const patterns = [
    new RegExp(`(?:^|\\n)#+\\s*${fieldName}\\s*\\n+([^\\n#]+)`, 'im'),
    new RegExp(`${fieldName}\\s*[:\\-]\\s*(.+)`, 'im'),
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match && match[1].trim()) {
      return match[1].trim();
    }
  }
  return '';
}

// ─── Test Data Extraction ─────────────────────────────────────────────────────

/**
 * Extracts the "Test Data" section from the story into a key-value map.
 * Parses lines like:
 *   - First Name: `##FirstName`
 *   - Country: `India`
 *   - Password: `BahutG@rmiHa1`
 */
function _extractTestDataFromStory(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  // Find "## Test Data" section — use indexOf for reliability on Windows
  const startMarker = content.indexOf('## Test Data');
  if (startMarker === -1) return result;

  // Find the next section heading or end of file
  const afterHeader = content.indexOf('\n', startMarker);
  if (afterHeader === -1) return result;

  const nextSection = content.indexOf('\n## ', afterHeader + 1);
  const nextSeparator = content.indexOf('\n---', afterHeader + 1);
  const endIdx = Math.min(
    nextSection > -1 ? nextSection : content.length,
    nextSeparator > -1 ? nextSeparator : content.length
  );

  const section = content.substring(afterHeader, endIdx).replace(/\r/g, '');
  const lines = section.split('\n');

  for (const line of lines) {
    // Match: "- Field Name: `value`"
    const match = line.match(/^[\s]*[-*]\s*(.+?):\s*`([^`]+)`/);
    if (match) {
      const key = match[1].trim().toLowerCase().replace(/\s+/g, '_');
      result[key] = match[2].trim();
    }
  }

  return result;
}

// ─── Step Replay Extraction ───────────────────────────────────────────────────

/**
 * Extracts ALL replayable actions from the user story for the crawler to execute.
 * This includes navigation clicks, form fills, selects, and checkbox checks.
 * The crawler will snapshot each page transition to capture elements from every page in the flow.
 *
 * Supported actions:
 * - Navigate to URL
 * - Click (buttons, links — causes page transitions or interactions)
 * - Enter/Fill (form inputs — allows login, registration, etc.)
 * - Select (dropdowns)
 * - Check (checkboxes — e.g., category filters)
 */
function _extractStoryStepsForReplay(content: string): { action: string; testData: string; expected: string }[] {
  const steps: { action: string; testData: string; expected: string }[] = [];

  // Extract from "Detailed Steps" section (preferred — most detailed)
  const detailedMatch = content.match(/##\s*Detailed\s+Steps\s*\n([\s\S]*?)(?=\n##\s[^#]|$)/i);
  // Extract from "Acceptance Criteria" section as fallback
  const acMatch = content.match(/##\s*Acceptance\s+Criteria\s*\n([\s\S]*?)(?=\n##\s[^#]|$)/i);

  const section = detailedMatch ? detailedMatch[1] : acMatch ? acMatch[1] : '';
  if (!section) return steps;

  // Also extract Test Data section for resolving ## placeholders
  const testDataMap = _extractTestDataFromStory(content);

  const lines = section.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.replace(/^[\s]*[-•]\s*/, '').replace(/\*\*/g, '').trim();
    if (!line || line.length < 5) continue;
    if (line.startsWith('#') || line.startsWith('Note:') || line.startsWith('Available')) continue;
    // Skip pure verification lines for replay (we're navigating, not asserting)
    if (line.match(/^Verify\s/) && !line.includes('Click') && !line.includes('click')) continue;

    const lineLower = line.toLowerCase();

    // ── Split compound lines: "Bold Title: action1, action2. action3" ──
    // Handles: "Registration: Click X, fill form with name, email, password, and submit"
    // Split on periods and actionable-comma boundaries
    const subActions = line.includes(':') && !line.match(/^https?:/)
      ? line.replace(/^[^:]+:\s*/, '').split(/\.\s+/).filter(s => s.trim().length > 3)
      : [line];

    for (const subAction of subActions) {
      const subLower = subAction.toLowerCase().trim();
      if (subLower.length < 4) continue;

      // Use subAction/subLower instead of line/lineLower for action detection
      const lineLower = subLower;
      const line_effective = subAction.trim();

    // ── Navigate to URL ────────────────────────────────────────────────
    if (lineLower.includes('navigate to') || lineLower.includes('open browser')) {
      const urlMatch = line.match(/`(https?:\/\/[^`]+)`/);
      if (urlMatch) {
        steps.push({
          action: `Navigate to ${urlMatch[1]}`,
          testData: urlMatch[1],
          expected: '',
        });
      }
    }
    // ── Enter / Fill actions (form inputs) ─────────────────────────────
    else if ((lineLower.includes('enter ') && (lineLower.includes(' in ') || lineLower.includes(' into '))) || lineLower.startsWith('fill ')) {
      // Patterns: "Enter email address `value` in the ... field"
      //           "Enter **First name** in the "First name" text field"
      const valueMatch = line.match(/`([^`]+)`/) || line.match(/["""]([^"""]+)["""]/);
      const fieldMatch = line.match(/(?:in(?:to)?)\s+(?:the\s+)?["""]([^"""]+)["""]/i)
        || line.match(/(?:in(?:to)?)\s+(?:the\s+)?(?:['"])([^'"]+)(?:['"])/i)
        || line.match(/(?:in(?:to)?)\s+(?:the\s+)?(\w[\w\s]*?)(?:\s+(?:text|input|field))/i);

      let fieldHint = fieldMatch ? fieldMatch[1] : '';
      let value = valueMatch ? valueMatch[1] : '';

      // Resolve ##placeholder values from Test Data section
      if (value.startsWith('##')) {
        const key = value.substring(2).toLowerCase().replace(/\s+/g, '_');
        value = testDataMap[key] || value;
      }

      // If value is empty or looks like a field name (not actual data), generate realistic test data
      // This handles "Enter a random name into the 'Name' field" where no explicit value is given
      if (!value || value === fieldHint || lineLower.includes('random')) {
        const fieldLower = (fieldHint || '').toLowerCase();
        if (fieldLower.includes('email') || fieldLower.includes('email address')) {
          value = `test${Date.now()}@test.com`;
        } else if (fieldLower.includes('password') || fieldLower.includes('passwd')) {
          value = 'TestPass@123';
        } else if (fieldLower.includes('name') && (fieldLower.includes('first') || fieldLower === 'name')) {
          value = 'TestUser';
        } else if (fieldLower.includes('last')) {
          value = 'Automation';
        } else if (fieldLower.includes('phone') || fieldLower.includes('mobile')) {
          value = '9876543210';
        } else if (fieldLower.includes('address')) {
          value = '123 Test Street';
        } else if (fieldLower.includes('city')) {
          value = 'TestCity';
        } else if (fieldLower.includes('state')) {
          value = 'TestState';
        } else if (fieldLower.includes('zip') || fieldLower.includes('postal')) {
          value = '560001';
        } else if (fieldLower.includes('company')) {
          value = 'TestCompany';
        } else if (!value) {
          value = 'TestValue';
        }
      }

      // If no field hint extracted, try to get it from the subject
      if (!fieldHint && value) {
        // "Enter email address `xxx`..." → hint = "email"
        const subjectMatch = line.match(/enter\s+(?:the\s+)?(\w[\w\s]*?)(?:\s+`|\s+in|\s+into)/i);
        if (subjectMatch) fieldHint = subjectMatch[1].trim();
      }

      if (fieldHint || value) {
        steps.push({
          action: `Enter "${value}" into "${fieldHint}"`,
          testData: value,
          expected: '',
        });
      }
    }
    // ── Select from dropdown ───────────────────────────────────────────
    else if (lineLower.includes('select') && (lineLower.includes('from') || lineLower.includes('dropdown'))) {
      const optionMatch = line.match(/select\s+(?:a\s+)?(?:\*\*)?([^*""`]+?)(?:\*\*)?\s+(?:from|in)/i)
        || line.match(/["""]([^"""]+)["""]/);
      const fieldMatch = line.match(/(?:from|in)\s+(?:the\s+)?["""]([^"""]+)["""]/i)
        || line.match(/(?:from|in)\s+(?:the\s+)?(\w[\w\s]*?)(?:\s+dropdown|\s*$)/i);

      const option = optionMatch ? optionMatch[1].trim() : '';
      const field = fieldMatch ? fieldMatch[1].trim() : 'dropdown';

      if (option) {
        steps.push({
          action: `Select "${option}" from "${field}"`,
          testData: option,
          expected: '',
        });
      }
    }
    // ── Check checkbox ─────────────────────────────────────────────────
    else if (lineLower.includes('check the') || lineLower.includes('check "') || lineLower.includes('check the "')) {
      const checkMatch = line.match(/check\s+(?:the\s+)?["""]([^"""]+)["""]/i);
      if (checkMatch) {
        steps.push({
          action: `Click ${checkMatch[1]}`,
          testData: '',
          expected: '',
        });
      }
    }
    // ── Click actions (buttons, links) ─────────────────────────────────
    else if (lineLower.includes('click on') || lineLower.includes('click the') || lineLower.includes('click "') || lineLower.startsWith('click ')) {
      const quotedMatch = line.match(/["""]([^"""]+)["""]/);
      if (quotedMatch) {
        steps.push({
          action: `Click ${quotedMatch[1]}`,
          testData: '',
          expected: '',
        });
      } else {
        // No quotes — extract the word after "click" (e.g., "Click Next", "Click Submit")
        const clickTarget = line.match(/click\s+(.+)/i);
        if (clickTarget) {
          steps.push({
            action: `Click ${clickTarget[1].trim()}`,
            testData: '',
            expected: '',
          });
        }
      }
    }
    } // end for subActions
  }

  return steps;
}

/**
 * Infers the element type from its key prefix or locator tag.
 * Used when seeding elements from an existing .properties file (which stores
 * only key=locator, not type). Matches the type vocabulary produced by the crawler.
 */
function _inferElementType(key: string, locator: string): string {
  const k = key.toLowerCase();
  const loc = locator.toLowerCase();

  if (k.startsWith('btn') || loc.includes('button') || loc.includes("//button")) return 'button';
  if (k.startsWith('input') || k.startsWith('txt')) {
    if (loc.includes('textarea') || loc.includes('//textarea')) return 'textarea';
    return 'input';
  }
  if (k.startsWith('select') || loc.includes('//select')) return 'select';
  if (k.startsWith('nav') || loc.includes('//a') || loc.includes('link')) return 'link';
  if (loc.includes('//textarea')) return 'textarea';
  if (loc.includes('//input')) return 'input';
  return 'other';
}

/**
 * Converts a PascalCase element key into a human-readable label.
 * e.g. "InputPreferredDate" → "Input Preferred Date", "BtnSubmitOrder" → "Btn Submit Order"
 */
function _humanizeKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
run().catch((err) => {
  console.error('[PlannerAgent] Fatal error:', err);
  process.exit(1);
});
