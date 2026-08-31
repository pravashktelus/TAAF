import * as fs from 'fs';
import * as path from 'path';
import { AgentsConfig } from '../config/AgentsConfig';
import { LLMClient } from '../core/LLMClient';
import { PlaywrightCrawler } from '../core/PlaywrightCrawler';
import { PageCrawler, PageSnapshot, DiscoveredElement } from '../core/PageCrawler';
import { PropertiesRegistry } from '../core/PropertiesRegistry';
import { ContextEnricher } from '../core/ContextEnricher';
import { SourceIndexProvider } from '../core/SourceIndexProvider';
import { OutputValidator } from '../core/OutputValidator';
import { PropertiesWriter } from './PropertiesWriter';
import { FeatureWriter } from './FeatureWriter';
import { GeneratePrompts } from './GeneratePrompts';
import { TestPlan } from '../planner/PlanFormatter';

/**
 * GeneratorAgent
 * --------------
 * Single command that handles everything internally:
 *   1. Read plan JSON (from Planner)
 *   2. Crawl live pages (if URLs provided) OR use registry + conventions (if no URL)
 *   3. Build element map — existing refs reused, new elements written to .properties
 *   4. Generate feature file via AI using real element refs
 *   5. Write review copy to generated/features/ (or directly to features/web/ with --apply)
 *
 * Usage:
 *   # Single plan — no URL needed
 *   npm run agent:generate -- --plan generated/plans/Support-plan_from_Story1.json
 *
 *   # Multiple plans (processed sequentially)
 *   npm run agent:generate -- --plan generated/plans/Plan1.json --plan generated/plans/Plan2.json
 *
 *   # Single URL
 *   npm run agent:generate -- --plan generated/plans/Support-plan_from_Story1.json --url https://app.com/support
 *
 *   # Multi-page flow
 *   npm run agent:generate -- --plan generated/plans/Support-plan_from_Story1.json --urls "https://app.com/login,https://app.com/orders,https://app.com/support"
 *
 *   # Login required + navigate to target
 *   npm run agent:generate -- --plan generated/plans/Support-plan_from_Story1.json --target-url https://app.com/support --login
 *
 *   # Apply directly to features/web/
 *   npm run agent:generate -- --plan generated/plans/Support-plan_from_Story1.json --url https://app.com/support --apply
 */

// ─── Args Interface ───────────────────────────────────────────────────────────

interface GeneratorArgs {
  plans: string[];
  url?: string;
  urls?: string[];
  targetUrl?: string;
  login: boolean;
  apply: boolean;
  forceCrawl: boolean;
}

// ─── Parse CLI Arguments ──────────────────────────────────────────────────────

function parseArgs(): GeneratorArgs {
  const args = process.argv.slice(2);
  const result: GeneratorArgs = { plans: [], login: false, apply: false, forceCrawl: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--plan':        result.plans.push(args[++i]); break;
      case '--url':         result.url = args[++i]; break;
      case '--urls':        result.urls = args[++i].split(',').map((u) => u.trim()); break;
      case '--target-url':  result.targetUrl = args[++i]; break;
      case '--login':       result.login = true; break;
      case '--apply':       result.apply = true; break;
      case '--force-crawl': result.forceCrawl = true; break;
    }
  }

  if (result.plans.length === 0) {
    console.error('[GeneratorAgent] ERROR: --plan is required (one or more).');
    console.error('Usage: npm run agent:generate -- --plan plan1.json --plan plan2.json');
    process.exit(1);
  }

  return result;
}

// ─── Helper: Extract page name from URL ──────────────────────────────────────

function _pageNameFromUrl(url: string): string {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1] || 'Page';
    return last.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  } catch {
    return 'Page';
  }
}

// ─── Helper: Auto-extract URLs from plan test case steps ─────────────────────

function _extractUrlsFromPlan(plan: TestPlan): string[] {
  const urlPattern = /https?:\/\/[^\s'"`,]+/g;
  const found = new Set<string>();

  plan.testCases.forEach((tc) => {
    // Check navigation path
    const navMatches = tc.navigation?.match(urlPattern) || [];
    navMatches.forEach((u) => found.add(u.replace(/[.,;)]+$/, ''))); // strip trailing punctuation

    // Check each step action + navigation
    tc.steps.forEach((s) => {
      const actionMatches = s.action?.match(urlPattern) || [];
      const navStepMatches = s.navigation?.match(urlPattern) || [];
      [...actionMatches, ...navStepMatches].forEach((u) =>
        found.add(u.replace(/[.,;)]+$/, ''))
      );
    });
  });

  if (found.size > 0) {
    console.log(`[GeneratorAgent] Auto-extracted URLs from plan: ${[...found].join(', ')}`);
  }

  return [...found];
}

// ─── Helper: Detect unresolved element refs in generated feature ─────────────

function _detectUnresolvedElements(
  featureContent: string,
  pageName: string,
  registry: PropertiesRegistry,
  pageUrl: string = ''
): string[] {
  const seen = new Set<string>();
  const unresolved: string[] = [];

  // Match 'PageName.ElementKey' refs where PageName matches current page
  const refPattern = new RegExp(`'${pageName}\\.(\\w+)'`, 'g');
  let match;
  while ((match = refPattern.exec(featureContent)) !== null) {
    const key = match[1];
    if (key === 'ElementKey' || seen.has(key)) continue;
    seen.add(key);

    // Check if this element already exists in registry
    const existingElements = registry.getPageElements(pageName);
    const exists = existingElements.some((el) => el.elementKey === key);
    if (!exists) {
      // Also check if it was written in the current run (.properties file on disk)
      const propsPath = path.resolve(process.cwd(), 'src', 'pages', 'properties', `${pageName}.properties`);
      let existsOnDisk = false;
      if (fs.existsSync(propsPath)) {
        const content = fs.readFileSync(propsPath, 'utf-8');
        existsOnDisk = content.split('\n').some((l) => l.startsWith(`${key}=`) && l.split('=')[1]?.trim().length > 0);
      }
      if (!existsOnDisk) {
        unresolved.push(key);
      }
    }
  }

  return unresolved;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const config = AgentsConfig.getInstance();

  if (!config.enabled) {
    console.warn('[GeneratorAgent] Agents disabled (agents.enabled=false in framework.properties).');
    process.exit(0);
  }

  const args = parseArgs();

  // If multiple plans provided, process each sequentially
  if (args.plans.length > 1) {
    console.log('═══════════════════════════════════════════');
    console.log('  Generator Agent — Batch Mode');
    console.log(`  Processing ${args.plans.length} plans sequentially`);
    console.log('═══════════════════════════════════════════\n');

    const results: { plan: string; featurePath: string; propsWritten: string[] }[] = [];

    for (let i = 0; i < args.plans.length; i++) {
      const planFile = args.plans[i];
      console.log(`\n┌─── Plan ${i + 1}/${args.plans.length}: ${planFile} ───┐\n`);

      try {
        const result = await runSingleGeneration({
          plan: planFile,
          url: args.url,
          urls: args.urls,
          targetUrl: args.targetUrl,
          login: args.login,
          apply: args.apply,
          forceCrawl: args.forceCrawl,
        });
        results.push({ plan: planFile, ...result });
        console.log(`└─── Plan ${i + 1} complete ───┘\n`);
      } catch (err) {
        console.error(`[GeneratorAgent] ❌ Failed processing plan: ${planFile}`);
        console.error(`  Error: ${err}`);
        console.log(`└─── Plan ${i + 1} FAILED ───┘\n`);
      }
    }

    // Summary
    console.log('\n═══════════════════════════════════════════');
    console.log('  Generator Agent — Batch Complete');
    console.log('═══════════════════════════════════════════');
    console.log(`  Processed: ${results.length}/${args.plans.length} plans`);
    results.forEach((r, i) => {
      console.log(`\n  [${i + 1}] ${r.plan}`);
      console.log(`      Feature: ${r.featurePath}`);
      if (r.propsWritten.length > 0) {
        r.propsWritten.forEach((p) => console.log(`      Props:   ${p}`));
      }
    });
    if (!args.apply) {
      console.log('\n  Review generated/features/ then apply:');
      const planFlags = args.plans.map((p) => `--plan "${p}"`).join(' ');
      console.log(`  npm run agent:generate -- ${planFlags} --apply`);
    } else {
      console.log('\n  All applied to features/web/ — run: npm test');
    }
    console.log('═══════════════════════════════════════════\n');
    return;
  }

  // Single plan — original flow
  const result = await runSingleGeneration({
    plan: args.plans[0],
    url: args.url,
    urls: args.urls,
    targetUrl: args.targetUrl,
    login: args.login,
    apply: args.apply,
    forceCrawl: args.forceCrawl,
  });

  // Done output for single plan
  console.log('\n═══════════════════════════════════════════');
  console.log('  Generator Agent — Complete');
  console.log('═══════════════════════════════════════════');

  if (result.propsWritten.length > 0) {
    console.log('  Properties files:');
    result.propsWritten.forEach((p) => console.log(`    ${p}`));
  } else {
    console.log('  Properties: No new elements — all existing refs reused');
  }

  console.log(`  Feature file: ${result.featurePath}`);
  console.log('');

  if (!args.apply) {
    console.log('  Review generated/features/ then apply:');
    console.log(`  npm run agent:generate -- --plan ${args.plans[0]} --apply`);
  } else {
    console.log('  Applied to features/web/ — run: npm test');
  }
  console.log('═══════════════════════════════════════════\n');
}

// ─── Single Generation Execution ─────────────────────────────────────────────

interface SingleGeneratorArgs {
  plan: string;
  url?: string;
  urls?: string[];
  targetUrl?: string;
  login: boolean;
  apply: boolean;
  forceCrawl?: boolean;
}

async function runSingleGeneration(args: SingleGeneratorArgs): Promise<{ featurePath: string; propsWritten: string[] }> {
  const config = AgentsConfig.getInstance();

  console.log('═══════════════════════════════════════════');
  console.log('  Generator Agent');
  console.log('═══════════════════════════════════════════');
  console.log(`  Plan:       ${args.plan}`);
  if (args.url)       console.log(`  URL:        ${args.url}`);
  if (args.urls)      console.log(`  URLs:       ${args.urls?.join(', ')}`);
  if (args.targetUrl) console.log(`  Target URL: ${args.targetUrl}`);
  if (args.login)     console.log(`  Login:      YES (auto-login enabled)`);
  console.log(`  Apply:      ${args.apply ? 'YES → features/web/' : 'NO → generated/features/ (review first)'}`);
  console.log(`  AI:         ${config.aiEnabled ? config.aiProvider : 'disabled (fallback mode)'}`);
  console.log('═══════════════════════════════════════════\n');

  // ── Step 1: Read plan JSON ─────────────────────────────────────────────────
  const planPath = path.isAbsolute(args.plan)
    ? args.plan
    : path.resolve(process.cwd(), args.plan);

  if (!fs.existsSync(planPath)) {
    console.error(`[GeneratorAgent] Plan file not found: ${planPath}`);
    process.exit(1);
  }

  const plan: TestPlan = JSON.parse(fs.readFileSync(planPath, 'utf-8'));
  console.log(`[GeneratorAgent] Plan: ${plan.page} | ${plan.testCases.length} test case(s) | Source: ${plan.sourceFile}`);

  if (!plan.testCases || plan.testCases.length === 0) {
    console.error('[GeneratorAgent] Plan has no test cases. Re-run Planner first:');
    console.error(`  npm run agent:plan -- --story <file> --page ${plan.page}`);
    process.exit(1);
  }

  // Detect API story early — determines what to skip
  const isApiStory = plan.mode === 'api' ||
    (plan as any).type === 'API' ||
    plan.testCases.some((tc) => tc.steps.some((s) =>
      s.action.toLowerCase().includes('send a') && (s.action.toLowerCase().includes('request') || s.action.toLowerCase().includes('get') || s.action.toLowerCase().includes('post'))
    ));

  // ── Guardrail: refuse to generate a WEB feature with NO real elements ──────
  // Without a verified element set (from plan crawl, a curated .properties, or
  // the source repo) the AI is forced to guess bindings — it force-fits every
  // step onto whatever few refs it can find and invents assertions. This is the
  // #1 cause of low-quality output (often triggered by a wrong --page name that
  // doesn't match any .properties / source-repo page). Fail loud with guidance
  // instead of silently emitting garbage.
  if (!isApiStory) {
    const planElementCount = (plan.elements || []).length;
    // A crawl would supply elements — only guard when NO crawl source exists.
    const willCrawl = !!(args.url || args.urls?.length || args.targetUrl ||
      (plan.url && plan.url.startsWith('http')));
    if (planElementCount === 0 && !willCrawl) {
      const probe = new PropertiesRegistry();
      probe.load();
      const registryCount = probe.getPageElements(plan.page).length;
      let sourceCount = 0;
      try {
        const sp = new SourceIndexProvider();
        sourceCount = sp.isAvailable() ? sp.getLocatorsForPage(plan.page).length : 0;
      } catch { /* source repo optional */ }

      if (registryCount === 0 && sourceCount === 0) {
        console.error('\n[GeneratorAgent] ✗ ABORTING: no verified UI elements available for this plan.');
        console.error(`  Page name in plan: '${plan.page}'`);
        console.error('  The plan has 0 crawled elements, no matching .properties file, and no');
        console.error('  source-repo locators for this page. Generating now would force the AI to');
        console.error('  guess element bindings and invent assertions.');
        console.error('\n  Fix one of the following, then re-run:');
        console.error(`    • Use the correct --page that matches an existing .properties file`);
        console.error(`      (e.g. --page TeleConnect, not the story filename).`);
        console.error(`    • Re-run the Generator with --url <appUrl> to crawl live elements.`);
        console.error(`    • Ensure the source repo (agents.appRepo.path) covers page '${plan.page}'`);
        console.error(`      via agents.appRepo.pageMap.`);
        process.exit(1);
      }
    }
  }

  // ── Step 2: Load properties registry ──────────────────────────────────────
  const registry = new PropertiesRegistry();
  if (!isApiStory) {
    registry.load();
    console.log(`[GeneratorAgent] Registry: ${registry.size} elements across ${registry.getPageNames().length} pages`);
  }

  // ── Step 3: Crawl live pages (if URLs provided) ────────────────────────────
  // SKIP crawling if the plan already has elements from the Planner's crawl
  // The Planner does a full step-replay crawl — no need to repeat it

  if (isApiStory) {
    console.log(`[GeneratorAgent] API story detected — skipping browser crawl (no UI elements needed)`);
  }

  const planHasElements = plan.elements && plan.elements.length > 0;

  if (planHasElements && !isApiStory) {
    console.log(`[GeneratorAgent] Plan already has ${plan.elements.length} elements from Planner crawl — skipping redundant browser crawl`);
  }

  // ── Coverage pre-check: decide whether a browser crawl is actually needed ──
  // The browser crawl is the slowest step (~30-90s: launch + login + step replay).
  // For KNOWN apps we now have two file-based, authoritative locator sources:
  //   • the curated .properties registry, and
  //   • the app SOURCE repo (data-testid extracted from .tsx).
  // If either already covers this page, a crawl adds little but costs a lot — so
  // we SKIP it even when --url is passed. --force-crawl overrides to always crawl
  // (use it to refresh locators from the live app / when source is stale).
  let sourceCovers = false;
  let registryCovers = false;
  if (!isApiStory) {
    registryCovers = registry.getPageElements(plan.page).length > 0;
    try {
      const sp = new SourceIndexProvider();
      sourceCovers = sp.isAvailable() && sp.getLocatorsForPage(plan.page).length > 0;
    } catch { /* source repo optional */ }
  }
  const coveredByFiles = planHasElements || registryCovers || sourceCovers;
  const skipCrawl = !isApiStory && coveredByFiles && !args.forceCrawl;

  if (skipCrawl) {
    const sources = [
      planHasElements ? 'plan' : '',
      registryCovers ? 'registry' : '',
      sourceCovers ? 'source-repo' : '',
    ].filter(Boolean).join(' + ');
    console.log(`[GeneratorAgent] ⚡ Skipping browser crawl — page '${plan.page}' covered by ${sources}. (Pass --force-crawl to crawl the live app anyway.)`);
  }

  const crawledSnapshots: Map<string, PageSnapshot> = new Map();
  let crawler: PlaywrightCrawler | null = null;

  const urlsToCrawl = (isApiStory || skipCrawl) ? [] : _resolveUrlsToCrawl(args, plan);

  if (urlsToCrawl.length > 0) {
    try {
      crawler = new PlaywrightCrawler();
      await crawler.launch();

      // Auto-login if requested
      if (args.login) {
        console.log('[GeneratorAgent] Auto-login enabled...');
        await crawler.login();
      }

      // Crawl each URL
      for (const url of urlsToCrawl) {
        console.log(`[GeneratorAgent] Crawling: ${url}`);
        const snapshot = await crawler.crawl(url);

        // Detect login redirect — if crawled URL differs from intended URL
        // OR if page title/content indicates login page despite URL match
        const intendedHost = new URL(url).hostname;
        const crawledUrl = snapshot.url;
        const isLoginPage = snapshot.elements.some((el) =>
          el.locator.includes('login-email') || el.locator.includes('login-password') || el.locator.includes('login-submit')
        );
        const isRedirectedToLogin =
          isLoginPage && !url.includes('login') && !url.includes('signin');

        if (isRedirectedToLogin) {
          console.warn(`[GeneratorAgent] ⚠️  Page requires login — got login form at: ${crawledUrl}`);
          console.log(`[GeneratorAgent] Auto-login and re-navigate to target: ${url}`);

          // Use loginAndNavigate to authenticate and reach the target page
          const targetSnapshot = await crawler.loginAndNavigate(url);
          const targetUrl = targetSnapshot.url;

          // Check if we successfully reached the target (not still on login)
          if (targetUrl.includes('login') || targetUrl.includes('signin')) {
            console.warn(`[GeneratorAgent] ⚠️  Login failed — could not reach ${url}`);
            console.warn(`[GeneratorAgent] ⚠️  Credentials may be invalid. Check testdata/runtime-store.json or framework.properties`);
          } else {
            const pageName = plan.page;
            crawledSnapshots.set(pageName, targetSnapshot);
            console.log(`[GeneratorAgent] ✅ Reached target page: ${targetUrl} → ${targetSnapshot.elements.length} elements on ${pageName}`);
          }
          continue;
        }

        const pageName = urlsToCrawl.length === 1 ? plan.page : _pageNameFromUrl(url);
        crawledSnapshots.set(pageName, snapshot);
        console.log(`[GeneratorAgent] → ${snapshot.elements.length} elements found on ${pageName}`);
      }

      // ── Auto-crawl related pages from navigation links ──────────────────
      // Instead of guessing pages, replay the actual test case steps to
      // navigate through the app and capture elements at each page transition
      if (crawledSnapshots.size > 0 && plan.testCases.length > 0) {
        const mainSnapshot = [...crawledSnapshots.values()][0];
        const baseUrl = new URL(urlsToCrawl[0]).origin;

        // Replay test case steps to discover all pages in the flow
        const allSteps = plan.testCases.flatMap((tc) =>
          tc.steps.map((s) => ({
            action: s.action,
            testData: s.testData || '',
            expected: s.expected || '',
          }))
        );

        if (allSteps.length > 0) {
          console.log(`[GeneratorAgent] Replaying ${allSteps.length} test steps to discover all pages in the flow...`);
          try {
            const replaySnapshots = await crawler!.replaySteps(allSteps, urlsToCrawl[0]);

            // Merge elements from all discovered pages into the main snapshot
            for (const rs of replaySnapshots) {
              let newCount = 0;
              rs.elements.forEach((el) => {
                if (!mainSnapshot.elements.some((e) => e.locator === el.locator)) {
                  mainSnapshot.elements.push(el);
                  newCount++;
                }
              });
              if (newCount > 0) {
                console.log(`[GeneratorAgent] → +${newCount} new elements from ${rs.url}`);
              }
            }
            console.log(`[GeneratorAgent] Step replay complete: total ${mainSnapshot.elements.length} elements across ${replaySnapshots.length + 1} pages`);
          } catch (err) {
            console.warn(`[GeneratorAgent] Step replay failed: ${err}. Using elements from initial crawl only.`);
          }
        }
      }
    } finally {
      if (crawler) await crawler.close();
    }
  } else if (!isApiStory && !skipCrawl && plan.url && plan.url.startsWith('http')) {
    // No --url flag but plan has a URL
    // If plan already has elements from Planner crawl, skip secondary browser crawl entirely
    // The Planner's step-replay already captured all pages in the flow
    if (planHasElements) {
      console.log(`[GeneratorAgent] Plan has ${plan.elements.length} elements from Planner crawl — using directly (no secondary browser crawl needed)`);
    } else {
      // Plan has no elements — try loginAndNavigate to capture them
      console.log(`[GeneratorAgent] No plan elements. Attempting login + navigate to: ${plan.url}`);
      try {
        crawler = new PlaywrightCrawler();
        await crawler.launch();
        const targetSnapshot = await crawler.loginAndNavigate(plan.url);
        if (!targetSnapshot.url.includes('login')) {
          crawledSnapshots.set(plan.page, targetSnapshot);
          console.log(`[GeneratorAgent] ✅ Reached ${plan.page} page: ${targetSnapshot.elements.length} elements captured`);
        } else {
          console.warn(`[GeneratorAgent] ⚠️  Login failed — using registry only`);
        }
      } catch (err) {
        console.warn(`[GeneratorAgent] ⚠️  Secondary crawl failed: ${err}. Using plan elements + registry.`);
      } finally {
        if (crawler) await crawler.close();
      }
    }
  } else {
    console.log('[GeneratorAgent] No URLs provided — using registry elements only');
  }

  // ── Step 4: Build element map (per page) ───────────────────────────────────
  // First: filter crawled elements by relevance to the story's test cases
  const storyKeywords = new Set<string>();
  plan.testCases.forEach((tc) => {
    // Extract meaningful keywords from actions and expected results
    const text = tc.steps.map((s) => `${s.action} ${s.expected} ${s.testData}`).join(' ').toLowerCase();
    text.split(/[\s'".,;:!?()]+/).forEach((w) => {
      if (w.length > 3 && !['should', 'given', 'when', 'then', 'that', 'with', 'from', 'into', 'have', 'this', 'been', 'page'].includes(w)) {
        storyKeywords.add(w);
      }
    });
  });
  // Also add navigation flow keywords
  const navFlow = (plan as any).navigationFlow || '';
  navFlow.toLowerCase().split(/[\s→>]+/).forEach((w: string) => {
    if (w.length > 3) storyKeywords.add(w.replace(/[^a-z]/g, ''));
  });

  // Filter crawled snapshots: keep only elements relevant to story context
  if (crawledSnapshots.size > 0) {
    // Detect if the story flow involves login
    const storyNeedsLogin = [...storyKeywords].some((kw) =>
      ['login', 'sign', 'signin', 'email', 'password', 'credential'].includes(kw)
    ) || plan.testCases.some((tc) =>
      tc.steps.some((s) => s.action.toLowerCase().match(/login|sign.in|enter.*email|enter.*password/))
    );

    crawledSnapshots.forEach((snapshot) => {
      const beforeCount = snapshot.elements.length;
      snapshot.elements = snapshot.elements.filter((el) => {
        const elText = `${el.key} ${el.label} ${el.locator}`.toLowerCase();
        // Always keep: inputs, selects, textareas (likely needed for forms)
        if (el.type === 'input' || el.type === 'select' || el.type === 'textarea') return true;
        // Always keep: buttons with meaningful labels (close, submit, search, login)
        if (el.type === 'button') return true;
        // Always keep login-related elements if the story flow needs login
        if (storyNeedsLogin && elText.match(/email|password|login|sign/)) return true;
        // Always keep cart/checkout elements for e-commerce flows
        if (elText.match(/cart|checkout|quantity/)) return true;
        // For links/other: only keep if keywords match
        return [...storyKeywords].some((kw) => elText.includes(kw));
      });
      console.log(`[GeneratorAgent] Story-context filter: ${beforeCount} → ${snapshot.elements.length} elements (${beforeCount - snapshot.elements.length} irrelevant removed)`);
    });
  }

  const elementRefs = new Map<string, string>();    // key → PageName.ElementKey
  const newElementsByPage = new Map<string, (DiscoveredElement & { source: string })[]>();

  if (crawledSnapshots.size > 0) {
    // URL-based: use real crawled elements
    crawledSnapshots.forEach((snapshot, pageName) => {
      snapshot.elements.forEach((el) => {
        const match = registry.findMatch(el.locator, pageName, el.key);
        elementRefs.set(`${pageName}.${el.key}`, match.ref);

        if (match.source === 'new') {
          if (!newElementsByPage.has(pageName)) newElementsByPage.set(pageName, []);
          newElementsByPage.get(pageName)!.push({ ...el, source: 'new' });
        }
      });
    });
    console.log(`[GeneratorAgent] Element map from crawl: ${elementRefs.size} refs`);
  } else if (planHasElements) {
    // Use plan elements directly (Planner already crawled)
    const pageName = plan.page;
    if (!newElementsByPage.has(pageName)) newElementsByPage.set(pageName, []);

    for (const el of plan.elements) {
      if (!el.key || !el.locator) continue;
      const ref = `${pageName}.${el.key}`;
      elementRefs.set(ref, ref);
      newElementsByPage.get(pageName)!.push({
        key: el.key,
        locator: el.locator,
        type: el.type || 'other',
        label: el.label || el.key,
        tag: el.tag || 'unknown',
        source: 'plan',
      });
    }
    console.log(`[GeneratorAgent] Element map from plan: ${elementRefs.size} refs (no crawl needed)`);
  }

  // ALWAYS inject from registry — complements crawled elements with existing refs
  // This ensures the deterministic step mapper can find Login, Nav, Dashboard elements
  if (!isApiStory) {
    _injectFromRegistry(plan, registry, elementRefs);
    console.log(`[GeneratorAgent] Element map total (crawl + registry): ${elementRefs.size} refs`);
  }

  // ── Step 4b: Seed AUTHORITATIVE elements from the app SOURCE repo ───────────
  // The dev repo's source (data-testid in .tsx) is a complete, authoritative
  // locator set — it covers pages a crawl can't reach (login SPA, deep wizard
  // steps) AND error elements the crawl/registry lack. This makes the Generator
  // independent of a successful crawl for known apps.
  //
  // Precedence: registry/crawl keys already in elementRefs WIN (not overwritten);
  // source only ADDS what's missing. New source elements are written to
  // .properties via newElementsByPage. Source validations are attached to the
  // plan so negative cases can assert REAL messages on REAL error elements.
  if (!isApiStory) {
    try {
      const sourceProvider = new SourceIndexProvider();
      if (sourceProvider.isAvailable()) {
        const sourceLocators = sourceProvider.getLocatorsForPage(plan.page);
        if (sourceLocators.length > 0) {
          if (!newElementsByPage.has(plan.page)) newElementsByPage.set(plan.page, []);
          const pageList = newElementsByPage.get(plan.page)!;
          const existingKeys = new Set(
            [...elementRefs.keys()].map((r) => r.split('.').slice(1).join('.').toLowerCase())
          );
          let addedFromSource = 0;
          for (const sl of sourceLocators) {
            if (existingKeys.has(sl.key.toLowerCase())) continue; // registry/crawl wins
            const ref = `${plan.page}.${sl.key}`;
            elementRefs.set(ref, ref);
            pageList.push({
              key: sl.key,
              locator: sl.locator,
              type: _inferTypeFromLocator(sl.key, sl.locator),
              label: sl.key,
              tag: 'unknown',
              source: 'source-repo',
            } as any);
            existingKeys.add(sl.key.toLowerCase());
            addedFromSource++;
          }
          console.log(`[GeneratorAgent] Source repo: added ${addedFromSource} authoritative element(s) from app source (element map now ${elementRefs.size} refs).`);

          // Attach source validations for honest negative-case generation.
          const sourceValidations = sourceProvider.getValidationsForPage(plan.page);
          if (sourceValidations.length > 0) {
            (plan as any).sourceValidations = sourceValidations;
            console.log(`[GeneratorAgent] Source repo: ${sourceValidations.length} validation rule(s) available for negative cases.`);
          }
        }
      }
    } catch (err) {
      console.warn(`[GeneratorAgent] Source-repo seeding skipped: ${(err as Error).message}`);
    }
  }


  // ── Step 5: Write properties files ────────────────────────────────────────
  const propertiesWriter = new PropertiesWriter();
  const writtenProps: string[] = [];

  if (!isApiStory) {
    if (newElementsByPage.size > 0) {
      // Write crawled new elements per page
      newElementsByPage.forEach((elements, pageName) => {
        const propsPath = propertiesWriter.write(pageName, elements as any);
        writtenProps.push(propsPath);
      });
    } else if (crawledSnapshots.size === 0) {
      // No URL — write convention-based placeholder for current page
      const conventionElements = _buildConventionElements(plan, elementRefs);
      if (conventionElements.length > 0) {
        const propsPath = propertiesWriter.write(plan.page, conventionElements as any);
        writtenProps.push(propsPath);
      }
    }
  } else {
    console.log(`[GeneratorAgent] API mode: Base URL: ${plan.url || '{api.baseUrl}'}`);
    console.log(`[GeneratorAgent] API mode: ${plan.testCases.length} endpoint test(s) to generate`);
    console.log(`[GeneratorAgent] API mode: No .properties file needed`);
  }

  // ── Step 6: Generate feature file (per-AC AI calls or deterministic fallback) ─
  console.log(`\n[GeneratorAgent] Generating feature file...`);

  // Relevance hint (page + url + source + test case titles) drives selective
  // domain knowledge — telecom knowledge loads only for telecom plans.
  const genRelevanceHint = [
    plan.page,
    plan.url || '',
    plan.sourceFile || '',
    plan.testCases.map((tc) => tc.title).join(' '),
  ].join(' ').slice(0, 4000);
  const frameworkContext = ContextEnricher.getFullContext(plan.page, genRelevanceHint);
  console.log(`[GeneratorAgent] Framework context: ${frameworkContext ? 'loaded' : 'none available'}`);

  let featureContent: string;

  if (config.aiEnabled) {
    // ── AI MODE: Generate steps per-AC with focused prompts ──────────────
    console.log(`[GeneratorAgent] Using per-AC AI generation (${config.aiProvider})...`);
    const moduleName = plan.page.toLowerCase();
    const featureLines: string[] = [];

    if (isApiStory) {
      featureLines.push(`@api @${moduleName}`);
      featureLines.push(`Feature: ${plan.page} - ${plan.sourceFile?.replace(/\.[^.]+$/, '') || 'API Tests'}`);
      featureLines.push(`  As a developer`);
      featureLines.push(`  I want to validate API endpoints`);
      featureLines.push('');
      featureLines.push(`  Background:`);
      featureLines.push(`    Given I set the base url to '${plan.url || '{api.baseUrl}'}'`);
    } else {
      featureLines.push(`@web @${moduleName}_web`);
      featureLines.push(`Feature: ${plan.page} - ${plan.sourceFile?.replace(/\.[^.]+$/, '') || 'Generated Feature'}`);
      featureLines.push(`  As a user`);
      featureLines.push(`  I want to interact with the ${plan.page} page`);
    }
    featureLines.push('');

    // Build available elements list for AI context
    const allElements = [...elementRefs.values()];

    // Each test case is generated INDEPENDENTLY, so the per-AC AI calls can run
    // CONCURRENTLY instead of sequentially. We build one async task per test case
    // that resolves to its rendered lines, run them all with Promise.all, then
    // assemble the feature in the original order. This cuts the AI phase from
    // (N × call-latency) to roughly a single call-latency.
    const scenarioTasks = plan.testCases.map((tc) => (async (): Promise<string[]> => {
      // NOTE: this is a thunk (arrow returning a promise) — NOT invoked here.
      // It is invoked in batches below so concurrency stays bounded.
      const scenarioLines: string[] = [];
      const tags = tc.type === 'negative' ? '@negative @regression' : '@smoke @e2e';
      scenarioLines.push(`  ${tags}`);
      scenarioLines.push(`  Scenario: ${tc.id} ${tc.title}`);
      if (!isApiStory) {
        scenarioLines.push(`    Given I navigate to the application`);
      }

      // Filter elements relevant to THIS AC's keywords (max 40)
      const acKeywords = tc.steps
        .map((s) => `${s.action} ${s.expected}`.toLowerCase())
        .join(' ')
        .split(/[\s'".,;:!?]+/)
        .filter((w) => w.length > 3);
      
      // Prioritize current page elements over other pages
      const currentPageElements = allElements.filter((ref) => ref.startsWith(`${plan.page}.`));
      
      // ONLY include current page elements — do NOT show other pages' elements
      // This prevents AI confusion between AutomationPractise.InputEmail vs TeleConnect.LoginEmail
      const relevantElements = currentPageElements.slice(0, 60);

      // If too few matched, include the first 30 elements as general context
      // Include locator info so AI can match action text to correct element
      const formatElementWithLabel = (ref: string): string => {
        const parts = ref.split('.');
        if (parts.length < 2) return `  '${ref}'`;
        const pageName = parts[0];
        const key = parts[1];

        // First check plan elements (new elements from crawl — these have exact locators)
        const planEl = plan.elements?.find((e: any) => e.key === key);
        if (planEl && planEl.locator) {
          return `  '${ref}' [locator: ${planEl.locator}]`;
        }

        // Then check registry (existing elements)
        const pageElements = registry.getPageElements(pageName);
        const el = pageElements.find((e) => e.elementKey === key);
        if (el && el.locator) {
          return `  '${ref}' [locator: ${el.locator}]`;
        }

        // Check newElementsByPage (crawled elements not yet in registry)
        const newEls = newElementsByPage.get(pageName);
        if (newEls) {
          const newEl = newEls.find((e) => e.key === key);
          if (newEl && newEl.locator) {
            return `  '${ref}' [locator: ${newEl.locator}]`;
          }
        }

        return `  '${ref}'`;
      };

      const availableElements = relevantElements.length >= 5 
        ? relevantElements.map(formatElementWithLabel)
        : currentPageElements.length > 0
          ? currentPageElements.map(formatElementWithLabel)
          : allElements.filter((ref) => ref.startsWith(`${plan.page}.`)).slice(0, 30).map(formatElementWithLabel);

      // Per-AC AI call
      // For API stories: if steps are already Gherkin-formatted, pass them through directly
      // This avoids AI dropping data tables or re-inventing step patterns
      // For API stories, ALWAYS use passthrough (both happy and negative cases)
      const stepsAreGherkin = isApiStory;

      let stepLines: string[];

      if (stepsAreGherkin) {
        // Direct passthrough — steps are already correct Gherkin from the story ACs
        stepLines = [];
        for (const s of tc.steps) {
          let action = s.action.replace(/^Verify:\s*/i, '').trim();
          // Skip "I set the base url" — it's in Background
          if (action.match(/I set the base url/i)) continue;

          // Extract any inline body table embedded in the action text:
          //   "...with body: [data: | key | value | | title | X |]"  or  "...with body: | key | value |"
          let inlineTable = '';
          const inlineDataMatch = action.match(/with body:\s*(?:\[data:\s*)?(\|.*)/i);
          if (inlineDataMatch) {
            inlineTable = inlineDataMatch[1].replace(/\]$/, '').trim();
            // Strip the inline table from the action, leave just "...with body:"
            action = action.replace(/(with body:).*/i, '$1');
          }

          // Strip any leading Gherkin keyword already in the action text
          // (e.g. AI produces "Then the response status should be 400" — we add our own keyword)
          action = action.replace(/^(?:Given|When|Then|And|But)\s+/i, '').trim();

          // Normalize action phrasing to match real step patterns
          action = action
            .replace(/^Send a /i, 'I send a ')
            .replace(/^Store /i, 'I store ');

          // Determine keyword based on the cleaned action
          let keyword = 'And';
          if (action.match(/^I send a/i)) keyword = 'When';
          else if (action.match(/^the response/i)) keyword = 'Then';
          else if (action.match(/^I set/i)) keyword = 'Given';

          stepLines.push(`    ${keyword} ${action}`);

          // Render data table — from testData field OR from inline extraction
          let tableSource = '';
          if (s.testData && s.testData.includes('|')) {
            tableSource = s.testData;
          } else if (inlineTable) {
            tableSource = inlineTable;
          }

          if (tableSource) {
            // Split into rows — handle both newline-separated and inline (| a | b | | c | d |)
            let rows: string[];
            if (tableSource.includes('\n')) {
              rows = tableSource.split('\n').filter((l) => l.trim().startsWith('|'));
            } else {
              // Inline format: "| key | value | | title | X |" → split on "| |" boundaries
              rows = tableSource.split(/\|\s*\|/).map((r, i, arr) => {
                let row = r.trim();
                if (!row.startsWith('|')) row = '| ' + row;
                if (!row.endsWith('|')) row = row + ' |';
                return row;
              });
            }
            rows.forEach((tl) => stepLines.push(`      ${tl.trim()}`));
          }
        }
      } else {
        // AI generation path (original)
        const acPrompt = isApiStory
          ? GeneratePrompts.buildPerACPromptAPI(tc, plan.url || '')
          : GeneratePrompts.buildPerACPrompt(tc, plan.page, availableElements, (plan as any).testData);
        const deterministicFallback = tc.steps.map((s) => {
          const mapped = GeneratePrompts['_mapStepToGherkin'](s, plan.page, elementRefs);
          return mapped.filter((l: string) => !l.startsWith('#')).map((l: string) => `    ${l}`).join('\n');
        }).join('\n');

        const aiSteps = await LLMClient.askWithSystem(
          `You are a BDD automation expert. Output ONLY Gherkin steps — no explanation, no markdown, no headers, no comments.
RULES:
- Include ALL steps from the test case — do NOT skip login, navigation, or setup steps.
- Every scenario runs independently in a fresh browser so ALL steps must be present.
- Use ONLY step patterns provided in the prompt — do NOT invent new patterns.
- Use ONLY elements from the "Available Elements" list — do NOT invent element keys.
- Element keys and locators are CASE-EXACT from the live DOM. Use them EXACTLY as shown (do NOT change casing).
- If an exact element is not available, use the CLOSEST matching element creatively.
- NEVER output comments (# FLAG, # NOTE, etc.) — only output executable Gherkin steps.
- For negative tests: use WRONG values (not $$variables) and end with url assertion to prove failure.
- NEVER use 'should have value' after entering data.
- All strings must have proper opening AND closing quotes.`,
          acPrompt,
          deterministicFallback
        );

        // Parse AI response — each line should be a step
        // Then fix any refs that AI invented (not in our element list)
        const validRefs = new Set([...elementRefs.keys(), ...elementRefs.values()]);
        const currentPageRefs = new Set(
          [...elementRefs.keys(), ...elementRefs.values()].filter((r) => r.startsWith(`${plan.page}.`))
        );
        // Build a lookup of all valid element keys (lowercased) for fuzzy matching
        const validKeysByPage = new Map<string, string>();
        [...currentPageRefs].forEach((r) => {
          const parts = r.split('.');
          if (parts.length === 2) validKeysByPage.set(parts[1].toLowerCase(), r);
        });

        stepLines = aiSteps
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.match(/^(When|Then|And|But|Given)\s/i) || l.trim().startsWith('|'))
          .map((l) => {
            // Keep table rows as-is
            if (l.trim().startsWith('|')) return `      ${l.trim()}`;
            // Replace any element refs — validate against known elements
            return l.replace(/'([A-Z][a-zA-Z0-9]+)\.([A-Za-z][A-Za-z0-9]+)'/g, (match, page, key) => {
              const fullRef = `${page}.${key}`;
            const keyLower = key.toLowerCase();

            // If it's already a valid ref (any page), keep it
            if (validRefs.has(fullRef)) return match;

            // If it's a current page ref that exists, keep it
            if (page === plan.page && validKeysByPage.has(keyLower)) {
              return `'${validKeysByPage.get(keyLower)}'`;
            }

            // Fuzzy match: try to find the closest valid key on current page
            const fuzzyMatch = _fuzzyMatchElement(keyLower, validKeysByPage);
            if (fuzzyMatch) return `'${fuzzyMatch}'`;

            // For refs from other pages, try to find equivalent on current page
            if (page !== plan.page) {
              const currentPageMatch = [...currentPageRefs].find((r) => {
                const parts = r.split('.');
                return parts[1]?.toLowerCase().includes(keyLower.replace('login', '').replace('nav', ''));
              });
              if (currentPageMatch) return `'${currentPageMatch}'`;
            }

            // Mark as INVALID — will be filtered out below
            return `'INVALID_REF:${page}.${key}'`;
          });
        })
        // Filter out lines with invalid (hallucinated) refs AND remove FLAG comment lines
        .filter((l) => !l.includes('INVALID_REF:') && !l.startsWith('# FLAG:'))
        .map((l) => l.trim().startsWith('|') ? l : `    ${l}`);

        if (stepLines.length === 0) {
          // AI returned nothing usable — use deterministic
          stepLines = deterministicFallback.split('\n').filter((l) => l.trim());
        }
      } // end else (AI path)

      if (stepLines.length > 0) {
        scenarioLines.push(...stepLines);
      }

      scenarioLines.push('');
      return scenarioLines;
    }));

    // Run per-AC generations concurrently (bounded), preserving order. A cap
    // avoids hammering the LLM API / hitting rate limits on large plans while
    // still giving most of the speedup over sequential calls.
    const CONCURRENCY = 4;
    console.log(`[GeneratorAgent] Generating ${scenarioTasks.length} scenario(s) — up to ${CONCURRENCY} concurrently...`);
    const scenarioResults: string[][] = new Array(scenarioTasks.length);
    for (let i = 0; i < scenarioTasks.length; i += CONCURRENCY) {
      const batch = scenarioTasks.slice(i, i + CONCURRENCY);
      // Invoke each thunk now so only this batch runs concurrently.
      const settled = await Promise.all(batch.map((task) => task()));
      settled.forEach((lines, j) => { scenarioResults[i + j] = lines; });
    }
    scenarioResults.forEach((lines) => featureLines.push(...lines));

    featureContent = featureLines.join('\n');

    // ── Post-generation auto-fix pass (correct common AI mistakes) ──────────
    featureContent = _postFixFeature(featureContent, elementRefs, plan.page);
    console.log(`[GeneratorAgent] Feature file generated via per-AC AI (${plan.testCases.length} scenarios) + auto-fix applied`);

  } else {
    // ── FALLBACK: deterministic step mapper ──────────────────────────────
    featureContent = GeneratePrompts.buildFallback(plan, elementRefs);
    console.log(`[GeneratorAgent] Feature file generated via deterministic mapper (no AI)`);
  }
  // ── Step 7: Detect unresolved element refs in feature (warn + strip) ────────
  const unresolvedElements = _detectUnresolvedElements(featureContent, plan.page, registry, plan.url || '');
  if (unresolvedElements.length > 0) {
    const urlHint = plan.url ? `\n  Crawl the page: npm run agent:generate -- --plan ${args.plan} --url ${plan.url}` : '';
    console.warn(`\n[GeneratorAgent] ⚠️  ${unresolvedElements.length} element(s) referenced in feature but NOT in ${plan.page}.properties:`);
    unresolvedElements.forEach((key) => console.warn(`    - ${plan.page}.${key}`));
    console.warn(`  These steps will be removed from the feature file.`);
    console.warn(`  Fix: Ensure the Planner crawls all pages in the flow (use --url with the starting page).${urlHint}\n`);

    // Strip lines referencing unresolved elements from feature content
    const unresolvedSet = new Set(unresolvedElements);
    featureContent = featureContent
      .split('\n')
      .filter((line) => {
        const refMatch = line.match(new RegExp(`'${plan.page}\\.(\\w+)'`));
        if (refMatch && unresolvedSet.has(refMatch[1])) {
          return false; // Drop this line — element doesn't exist
        }
        return true;
      })
      .join('\n');

    console.log(`[GeneratorAgent] Stripped ${unresolvedElements.length} step(s) with unresolved element refs`);
  }

  // ── Step 7b: Validate output (P6 — gate before --apply) ───────────────────
  // Reload registry to pick up newly-written .properties files from Step 5
  const freshRegistry = new PropertiesRegistry();
  freshRegistry.load();
  const validator = new OutputValidator(freshRegistry);
  const validation = validator.validate(featureContent, plan, args.apply);
  validator.printResults(validation);

  if (!validation.valid && args.apply) {
    console.error('[GeneratorAgent] ❌ Cannot apply — validation failed. Fix errors above first.');
    console.error('[GeneratorAgent] Run without --apply to generate a review copy instead.');
    process.exit(1);
  }

  // ── Step 8: Write feature file ─────────────────────────────────────────────
  const featureWriter = new FeatureWriter();
  // Derive source suffix — strip page name + "-plan_from_" to avoid duplication
  // e.g. "Support-plan_from_CustomerSupport_Story1" → "CustomerSupport_Story1"
  const planBaseName = path.basename(planPath, '.json');
  const sourceSuffix = planBaseName
    .replace(new RegExp(`^${plan.page}-plan_from_`, 'i'), '')
    .replace(/^[^_]+-plan_from_/, '')
    || plan.page;

  // ── Step 8b: Mask credentials in feature file ─────────────────────────────
  // Replace credential values with $$Secret references and save actual values to runtime-store
  featureContent = _maskCredentialsInFeature(featureContent, plan.page);

  const featurePath = featureWriter.write(featureContent, plan.page, sourceSuffix, args.apply, isApiStory);

  // ── Done ──────────────────────────────────────────────────────────────────
  return { featurePath, propsWritten: writtenProps };
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

function _resolveUrlsToCrawl(args: SingleGeneratorArgs, plan: TestPlan): string[] {
  // Priority 1: explicit --url or --urls flags
  if (args.urls && args.urls.length > 0) return args.urls;
  if (args.targetUrl) return [args.targetUrl];
  if (args.url) return [args.url];

  // Priority 2a: plan.url (top-level URL from Planner)
  if (plan.url && plan.url.startsWith('http')) {
    console.log(`[GeneratorAgent] Using plan.url: ${plan.url}`);
    return [plan.url];
  }

  // Priority 2b: auto-extract URLs from plan steps/navigation
  const extracted = _extractUrlsFromPlan(plan);
  if (extracted.length > 0) return extracted;

  // Priority 3: no URLs → falls through to registry injection
  return [];
}

/**
 * Infers a DiscoveredElement type from a source-repo element's key/locator.
 * Source elements only carry key + XPath, so type is derived from the key prefix
 * and the tag embedded in the locator. Used when seeding source-repo elements.
 */
function _inferTypeFromLocator(key: string, locator: string): string {
  const k = key.toLowerCase();
  const loc = locator.toLowerCase();
  if (k.startsWith('btn') || loc.includes('//button') || loc.includes('button')) return 'button';
  if (k.startsWith('select') || loc.includes('//select')) return 'select';
  if (loc.includes('//textarea')) return 'textarea';
  if (k.startsWith('input') || loc.includes('//input')) return 'input';
  if (k.startsWith('nav') || loc.includes('//a')) return 'link';
  return 'other';
}

function _injectFromRegistry(
  plan: TestPlan,
  registry: PropertiesRegistry,
  elementRefs: Map<string, string>
): void {
  // Skip registry injection if the plan targets a DIFFERENT application domain
  // This prevents cross-app contamination (e.g., Sauce Demo locators injected into Flipkart tests)
  const planUrl = plan.url || '';
  const config = AgentsConfig.getInstance();
  const frameworkUrl = config.appUrl || '';

  if (planUrl && frameworkUrl) {
    try {
      const planDomain = new URL(planUrl).hostname;
      const frameworkDomain = new URL(frameworkUrl).hostname;
      if (planDomain !== frameworkDomain) {
        console.log(`[GeneratorAgent] Skipping registry injection — plan targets ${planDomain} (framework is ${frameworkDomain})`);
        // Only inject elements from the plan's own page (already crawled)
        const directElements = registry.getPageElements(plan.page);
        directElements.forEach((el) => elementRefs.set(el.ref, el.ref));
        return;
      }
    } catch { /* URL parsing failed, continue with injection */ }
  }

  const allPageNames = registry.getPageNames();
  const planPageLower = plan.page.toLowerCase();

  // 1. Direct page name match
  const directElements = registry.getPageElements(plan.page);
  directElements.forEach((el) => elementRefs.set(el.ref, el.ref));

  // 2. Fuzzy match — "Support" matches "CustomerSupport" and vice versa
  allPageNames.forEach((pageName) => {
    if (pageName.toLowerCase() === planPageLower) return;
    const regPageLower = pageName.toLowerCase();
    if (regPageLower.includes(planPageLower) || planPageLower.includes(regPageLower)) {
      const els = registry.getPageElements(pageName);
      els.forEach((el) => {
        if (!elementRefs.has(el.ref)) elementRefs.set(el.ref, el.ref);
      });
      console.log(`[GeneratorAgent] Fuzzy match: ${pageName} → ${els.length} elements injected`);
    }
  });

  // 3. Navigation-referenced pages (e.g. Login → Dashboard → Orders)
  const navigationText = plan.testCases
    .map((tc) => `${tc.navigation} ${tc.steps.map((s) => s.action).join(' ')}`)
    .join(' ')
    .toLowerCase();

  // Always include TeleConnect (login page) — but ONLY if the plan page doesn't have its own login/email fields
  // Skip if the current page already has InputEmail/InputPassword (e.g., registration page)
  const currentPageHasOwnFields = [...elementRefs.values()].some((r) =>
    r.startsWith(`${plan.page}.`) && (r.includes('InputEmail') || r.includes('InputPassword'))
  );

  if (!navigationText.includes('teleconnect') && !currentPageHasOwnFields) {
    const loginKeywords = ['login', 'sign in', 'sign-in', 'credentials'];
    const hasLoginSteps = loginKeywords.some((kw) => navigationText.includes(kw));
    if (hasLoginSteps) {
      const teleConnectEls = registry.getPageElements('TeleConnect');
      teleConnectEls.forEach((el) => {
        if (!elementRefs.has(el.ref)) elementRefs.set(el.ref, el.ref);
      });
      if (teleConnectEls.length > 0) {
        console.log(`[GeneratorAgent] Login detected: TeleConnect → ${teleConnectEls.length} elements injected`);
      }
    }
  } else if (currentPageHasOwnFields) {
    console.log(`[GeneratorAgent] Skipping TeleConnect injection — ${plan.page} has its own email/password fields`);
  }

  allPageNames.forEach((pageName) => {
    const regPageLower = pageName.toLowerCase();
    if (regPageLower === planPageLower) return;
    if (navigationText.includes(regPageLower)) {
      const els = registry.getPageElements(pageName);
      els.forEach((el) => {
        if (!elementRefs.has(el.ref)) {
          elementRefs.set(el.ref, el.ref);
        }
      });
      console.log(`[GeneratorAgent] Navigation match: ${pageName} → ${els.length} elements injected`);
    }
  });
}

/**
 * Post-generation auto-fix: corrects common AI mistakes in the generated feature.
 * Gets us from ~65% to ~85%+ correctness.
 */
function _postFixFeature(
  content: string,
  elementRefs: Map<string, string>,
  pageName: string
): string {
  let fixed = content;

  // 1. Fix "the page url should contain" → "the url should contain"
  fixed = fixed.replace(/Then the page url should contain/g, 'Then the url should contain');

  // 2. Remove duplicate "Given I am on the application" / "Given I am on the app"
  fixed = fixed.replace(/(\s+Given I navigate to the application\n)\s+Given I (?:am on|navigate to) the (?:application|app)[^\n]*/g, '$1');

  // 3. Remove invalid "Given I am on the X page" lines (not a real step)
  fixed = fixed.replace(/\s+Given I am on (?:the )?(?!the application)[^\n]+\n/g, '\n');

  // 4. Fix "should expand" → "should be visible"
  fixed = fixed.replace(/should expand/g, 'should be visible');

  // 5. Fix "should be displayed" → "should be visible"
  fixed = fixed.replace(/should be displayed/g, 'should be visible');

  // 6. Fix login element mismatches: ONLY remap if this is a login-focused page
  // Skip this fix entirely if the plan page is NOT the login page (e.g., registration pages)
  const isLoginFlow = pageName.toLowerCase().includes('login') || pageName.toLowerCase() === 'teleconnect';
  
  if (isLoginFlow) {
    const loginEmailRef = [...elementRefs.values()].find((r) => r.toLowerCase().includes('loginemail'));
    const loginPasswordRef = [...elementRefs.values()].find((r) => r.toLowerCase().includes('loginpassword'));
    const loginSubmitRef = [...elementRefs.values()].find((r) => r.toLowerCase().includes('loginsubmit'));

    if (loginEmailRef) {
      // Only fix generic refs that DON'T belong to the current page
      fixed = fixed.replace(new RegExp(`'(?!${pageName}\\.)[A-Z][a-zA-Z]+\\.(?:Input)?Email'`, 'g'), `'${loginEmailRef}'`);
    }
    if (loginPasswordRef) {
      fixed = fixed.replace(new RegExp(`'(?!${pageName}\\.)[A-Z][a-zA-Z]+\\.(?:Input)?Password'`, 'g'), `'${loginPasswordRef}'`);
    }
    if (loginSubmitRef) {
      fixed = fixed.replace(
        new RegExp(`(into '${loginPasswordRef?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') || 'TeleConnect.LoginPassword'}'\\s*\\n\\s*(?:When|And) I click )'[A-Z][a-zA-Z]+\\.[A-Za-z]+'`, 'g'),
        `$1'${loginSubmitRef}'`
      );
    }
  }

  // 7. Fix "Then 'text content' should be visible" → needs Page.Element format
  // 7. Remove steps that reference plain text (no dot) as element — AI hallucination
  // e.g., "Then 'Product added to shopping cart.' should be visible" is not a valid element ref
  const lines = fixed.split('\n');
  fixed = lines.filter((line) => {
    // Match steps with single-quoted refs that have NO dot (plain text, not Page.Element)
    const plainTextRef = line.match(/(?:Then|And|When)\s+'([^'.]+)'\s+should\s+(?:be visible|have text|contain text|be hidden)/);
    if (plainTextRef) {
      const text = plainTextRef[1];
      // If it's just text with no dot, it's a hallucinated ref — drop it
      if (!text.includes('.')) return false;
    }
    // Also drop lines like "the cart icon should have text '1'" — not a valid step pattern
    if (line.match(/the cart (?:icon|count) should/i)) return false;
    // Drop "should not be visible" — not a valid step pattern in this framework
    if (line.match(/should not be visible/i)) return false;
    return true;
  }).join('\n');

  // 8. Remove completely empty scenarios (only Given + nothing)
  // Keep scenarios that have at least one When or Then after Given

  // 9. Fix doubled single quotes in element refs
  fixed = fixed.replace(/''/g, "'");

  // 10. Remove AI-invented modifiers after element refs ('with self-healing', 'in order', etc.)
  fixed = fixed.replace(/' with self-healing/g, "'");
  fixed = fixed.replace(/' with retry/g, "'");

  // 11. Fix element mismatches where action text clearly indicates a specific element
  // "View Details" click should use BtnViewDetails not OrderItem0
  const viewDetailsRef = [...elementRefs.values()].find((r) => r.toLowerCase().includes('viewdetails'));
  if (viewDetailsRef) {
    fixed = fixed.replace(/When I click '([^']+\.OrderItem\d+)'/g, `When I click '${viewDetailsRef}'`);
  }

  // 12. API-specific fixes
  // "response status code should be" → "response status should be"
  fixed = fixed.replace(/response status code should be/g, 'response status should be');
  // "response body field 'x' should be 'y'" → "response body field 'x' should equal 'y'"
  fixed = fixed.replace(/response body field '([^']+)' should be '([^']+)'/g, "response body field '$1' should equal '$2'");
  // "I set the base URL" → "I set the base url" (case fix)
  fixed = fixed.replace(/I set the base URL/g, 'I set the base url');
  // Remove duplicate "Given I set the base url" when Background already has it
  if (fixed.includes('Background:') && fixed.includes("Given I set the base url")) {
    // Keep only the one in Background, remove from scenarios
    const lines = fixed.split('\n');
    let inBackground = false;
    let backgroundUrlDone = false;
    const cleaned = lines.filter((line) => {
      if (line.trim().startsWith('Background:')) { inBackground = true; return true; }
      if (inBackground && line.trim().startsWith('Given I set the base url')) { backgroundUrlDone = true; return true; }
      if (inBackground && line.trim().startsWith('Scenario') || line.trim().startsWith('@')) { inBackground = false; }
      // Remove base url lines inside scenarios if Background already has one
      if (backgroundUrlDone && !inBackground && line.trim().startsWith('Given I set the base url')) return false;
      return true;
    });
    fixed = cleaned.join('\n');
  }
  // "Then I store" → "And I store" (store is usually continuation)
  fixed = fixed.replace(/\n(\s*)Then I store/g, '\n$1And I store');

  // Fix doubled Gherkin keywords: "And Then ...", "When Then ...", "Then When ..." → keep the first
  fixed = fixed.replace(/^(\s*)(Given|When|Then|And|But)\s+(Given|When|Then|And|But)\s+/gm, '$1$2 ');

  // Fix "GET request ... with query params:" that has NO table below it → make it a plain GET
  // The "with query params:" step REQUIRES a data table; without one it crashes at runtime
  {
    const lines = fixed.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*)(When|And|Given)\s+I send a GET request to (['"][^'"]+['"])\s+with query params:\s*$/);
      if (m) {
        // Check if next non-empty line is a table row
        const nextLine = (lines[i + 1] || '').trim();
        if (!nextLine.startsWith('|')) {
          // No table — convert to plain GET request
          lines[i] = `${m[1]}${m[2]} I send a GET request to ${m[3]}`;
        }
      }
    }
    fixed = lines.join('\n');
  }

  return fixed;
}

/**
 * Fuzzy match an AI-invented element key to the closest valid element on the current page.
 * Uses keyword extraction and substring matching.
 */
function _fuzzyMatchElement(keyLower: string, validKeysByPage: Map<string, string>): string | null {
  // Direct case-insensitive match
  if (validKeysByPage.has(keyLower)) return validKeysByPage.get(keyLower)!;

  // Common AI hallucination patterns → real element mapping
  const patterns: [RegExp, string[]][] = [
    [/email/i, ['inputemail', 'email']],
    [/password/i, ['inputpassword', 'password']],
    [/login.*submit|submit.*login|btnlogin/i, ['btnloginsubmit', 'loginsubmit', 'btnregistersubmit']],
    [/register.*submit|submit.*register/i, ['btnregistersubmit', 'registersubmit']],
    [/sign.*in|signin/i, ['navnavsignin', 'navsignin']],
    [/home/i, ['navnavhome', 'navhome']],
    [/cart.*quantity|cart.*count/i, ['cartquantity', 'navcart']],
    [/add.*cart/i, ['btnaddtocart', 'addtocart']],
    [/product.*name/i, ['productname']],
    [/unit.*price|product.*price/i, ['unitprice']],
    [/first.*name/i, ['inputfirstname', 'firstname']],
    [/last.*name/i, ['inputlastname', 'lastname']],
    [/country/i, ['selectcountry', 'country']],
    [/phone/i, ['inputphone', 'phone']],
    [/register.*link/i, ['navregisterlink', 'registerlink']],
  ];

  for (const [pattern, candidates] of patterns) {
    if (pattern.test(keyLower)) {
      for (const candidate of candidates) {
        if (validKeysByPage.has(candidate)) return validKeysByPage.get(candidate)!;
      }
    }
  }

  // Substring match: if the invented key contains a valid key or vice versa
  for (const [validKey, ref] of validKeysByPage) {
    if (keyLower.includes(validKey) || validKey.includes(keyLower)) {
      return ref;
    }
  }

  return null;
}

function _buildConventionElements(
  plan: TestPlan,
  elementRefs: Map<string, string>
): (DiscoveredElement & { source: string })[] {
  // Convention-based element generation is DISABLED.
  // Writing TODO/placeholder locators to .properties files causes runtime failures.
  // Instead, the user should provide --url for live DOM crawling.
  if (plan.testCases.length > 0) {
    console.log('[GeneratorAgent] ℹ️  No URL provided and no existing .properties for this page.');
    console.log('[GeneratorAgent] ℹ️  Provide --url to auto-crawl real locators, or create the properties file manually.');
  }
  return [];
}

/**
 * Detects credential values in the feature file and replaces them with $$Secret references.
 * Saves actual values to testdata/runtime-store.json so the framework resolves them at runtime.
 */
function _maskCredentialsInFeature(content: string, pageName: string): string {
  const secrets: Record<string, string> = {};
  let secretIndex = 0;

  // Split feature into scenarios to only mask credentials in happy-path scenarios
  // Negative scenarios intentionally use wrong/invalid values — don't mask those
  const lines = content.split('\n');
  let inNegativeScenario = false;
  const processedLines: string[] = [];

  for (const line of lines) {
    // Detect scenario type by looking at tags
    if (line.trim().startsWith('@negative')) {
      inNegativeScenario = true;
    } else if (line.trim().startsWith('@smoke') || line.trim().startsWith('@e2e')) {
      inNegativeScenario = false;
    }

    // Mask credentials in ALL scenarios (not just happy path).
    // In negative scenarios, only mask if the field is a credential field AND the value
    // matches the known test credentials (not intentionally wrong values).
    // Match all step verbs: "I enter", "I type", "I fill", "I input"
    // Match both single-quoted and double-quoted values
    if (line.match(/\s+(?:When|And|Given)\s+I (?:enter|type|fill|input)\s+['"]/)) {
      const masked = line.replace(
        /((?:When|And|Given)\s+I (?:enter|type|fill|input)\s+['"])([^'"]+)(['"]\s+into\s+['"])([^'"]+)(['"])/,
        (match, prefix, value, mid, elementRef, suffix) => {
          // NEVER mask ## tokens (random data generators) or $$ variables (already masked/cross-scenario)
          // These are framework syntax, not real credentials
          if (value.startsWith('##') || value.startsWith('$$') || value.startsWith('{')) {
            return match;
          }

          const elementLower = elementRef.toLowerCase();
          const isEmailField = elementLower.includes('email') || elementLower.includes('username') || elementLower.includes('user');
          const isPasswordField = elementLower.includes('password') || elementLower.includes('passwd');
          const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
          // Relaxed password detection: 4+ chars that look like real credentials (not test filler like 'aaa')
          const looksLikePassword = value.length >= 4 && !value.match(/^(.)\1+$/) && (
            (/[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9!@#$%^&*]/.test(value)) ||
            (isPasswordField)
          );

          if (isEmailField || isPasswordField || looksLikeEmail || looksLikePassword) {
            // In negative scenarios, skip masking if the value is intentionally wrong
            // (e.g., 'invaliduser', SQL injection, empty strings, 'xxx', clearly fake values)
            if (inNegativeScenario) {
              const isIntentionallyWrong =
                value === '' ||
                value.length <= 2 ||
                value.match(/^(invalid|wrong|fake|bad|test|xxx|aaa)/i) ||
                value.includes("'") || value.includes('"') || // SQL injection
                value.includes('OR') || value.includes('--') ||
                value.match(/^(.)\1{3,}$/) || // repeated chars like 'aaaa'
                value.match(/^[a-z]{10,}$/); // long random lowercase (filler)
              if (isIntentionallyWrong) return match;
            }

            let secretKey: string;
            if (elementLower.includes('username') || elementLower.includes('user')) {
              secretKey = 'username';
            } else if (isEmailField || looksLikeEmail) {
              secretKey = 'email';
            } else if (isPasswordField || looksLikePassword) {
              secretKey = 'password';
            } else {
              secretIndex++;
              secretKey = `secret_${secretIndex}`;
            }

            secrets[secretKey] = value;
            return `${prefix}$$${secretKey}${mid}${elementRef}${suffix}`;
          }
          return match;
        }
      );
      processedLines.push(masked);
    } else {
      processedLines.push(line);
    }
  }

  // Save secrets to runtime-store.json if any were detected
  if (Object.keys(secrets).length > 0) {
    const storePath = path.resolve(process.cwd(), 'testdata', 'runtime-store.json');
    let existing: Record<string, unknown> = {};
    if (fs.existsSync(storePath)) {
      try { existing = JSON.parse(fs.readFileSync(storePath, 'utf-8')); } catch { /* empty */ }
    } else {
      const dir = path.dirname(storePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    Object.entries(secrets).forEach(([key, value]) => {
      existing[key] = value;
    });

    fs.writeFileSync(storePath, JSON.stringify(existing, null, 2), 'utf-8');
    console.log(`[GeneratorAgent] Credentials masked in feature file → ${Object.keys(secrets).length} secret(s) saved to testdata/runtime-store.json`);
    Object.keys(secrets).forEach((k) => console.log(`    $$${k} = *****`));
  }

  return processedLines.join('\n');
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
run().catch((err) => {
  console.error('[GeneratorAgent] Fatal error:', err);
  process.exit(1);
});
