import * as fs from 'fs';
import * as path from 'path';
import { AgentsConfig } from '../config/AgentsConfig';
import { LLMClient } from '../core/LLMClient';
import { PageCrawler, PageSnapshot, DiscoveredElement } from '../core/PageCrawler';
import { PropertiesRegistry } from '../core/PropertiesRegistry';
import { ContextEnricher } from '../core/ContextEnricher';
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
 *   # Minimal — no URL needed
 *   npm run agent:generate -- --plan generated/plans/Support-plan_from_Story1.json
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
  plan: string;
  url?: string;
  urls?: string[];
  targetUrl?: string;
  login: boolean;
  apply: boolean;
}

// ─── Parse CLI Arguments ──────────────────────────────────────────────────────

function parseArgs(): GeneratorArgs {
  const args = process.argv.slice(2);
  const result: GeneratorArgs = { plan: '', login: false, apply: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--plan':        result.plan = args[++i]; break;
      case '--url':         result.url = args[++i]; break;
      case '--urls':        result.urls = args[++i].split(',').map((u) => u.trim()); break;
      case '--target-url':  result.targetUrl = args[++i]; break;
      case '--login':       result.login = true; break;
      case '--apply':       result.apply = true; break;
    }
  }

  if (!result.plan) {
    console.error('[GeneratorAgent] ERROR: --plan is required.');
    console.error('Usage: npm run agent:generate -- --plan generated/plans/{Page}-plan_from_{source}.json');
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
      unresolved.push(key);
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

  // ── Step 2: Load properties registry ──────────────────────────────────────
  const registry = new PropertiesRegistry();
  registry.load();
  console.log(`[GeneratorAgent] Registry: ${registry.size} elements across ${registry.getPageNames().length} pages`);

  // ── Step 3: Crawl live pages (if URLs provided) ────────────────────────────
  const crawledSnapshots: Map<string, PageSnapshot> = new Map();
  let crawler: PageCrawler | null = null;

  const urlsToCrawl = _resolveUrlsToCrawl(args, plan);

  if (urlsToCrawl.length > 0) {
    try {
      crawler = new PageCrawler();
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
        const intendedHost = new URL(url).hostname;
        const crawledUrl = snapshot.url;
        const isRedirectedToLogin =
          crawledUrl !== url &&
          (crawledUrl.includes('login') || crawledUrl.includes('signin') || !crawledUrl.includes(intendedHost));

        if (isRedirectedToLogin) {
          console.warn(`[GeneratorAgent] ⚠️  Page requires login — redirected to: ${crawledUrl}`);
          console.warn(`[GeneratorAgent] ⚠️  Attempting step-replay using test case data...`);

          // Step-replay: use test case steps to navigate the app
          if (plan.testCases.length > 0 && plan.testCases[0].steps.length > 0) {
            const steps = plan.testCases[0].steps.map((s) => ({
              action: s.action,
              testData: s.testData,
              expected: s.expected,
            }));

            const replaySnapshots = await crawler.replaySteps(steps, crawledUrl);
            replaySnapshots.forEach((snap, i) => {
              const pageName = _pageNameFromUrl(snap.url);
              crawledSnapshots.set(pageName, snap);
              console.log(`[GeneratorAgent] → Replay snapshot ${i + 1}: ${snap.elements.length} elements on ${pageName} (${snap.url})`);
            });
          }
          continue;
        }

        const pageName = _pageNameFromUrl(url);
        crawledSnapshots.set(pageName, snapshot);
        console.log(`[GeneratorAgent] → ${snapshot.elements.length} elements found on ${pageName}`);
      }
    } finally {
      if (crawler) await crawler.close();
    }
  } else if (plan.testCases.length > 0 && plan.testCases[0].steps.length > 0) {
    // No URL but test cases have steps — replay from app.url
    const appUrl = config.appUrl;
    if (appUrl) {
      console.log(`[GeneratorAgent] No URL provided — replaying test case steps from app.url: ${appUrl}`);
      try {
        crawler = new PageCrawler();
        await crawler.launch();

        const steps = plan.testCases[0].steps.map((s) => ({
          action: s.action,
          testData: s.testData,
          expected: s.expected,
        }));

        const replaySnapshots = await crawler.replaySteps(steps, appUrl);
        replaySnapshots.forEach((snap, i) => {
          const pageName = _pageNameFromUrl(snap.url);
          crawledSnapshots.set(pageName, snap);
          console.log(`[GeneratorAgent] → Replay snapshot ${i + 1}: ${snap.elements.length} elements on ${pageName} (${snap.url})`);
        });
      } finally {
        if (crawler) await crawler.close();
      }
    } else {
      console.log('[GeneratorAgent] No URLs and no app.url — using registry + convention-based elements');
    }
  } else {
    console.log('[GeneratorAgent] No URLs provided — using registry + convention-based elements');
  }

  // ── Step 4: Build element map (per page) ───────────────────────────────────
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
    console.log(`[GeneratorAgent] Element map built: ${elementRefs.size} total refs`);

  } else {
    // No URL: inject from registry using page name matching
    _injectFromRegistry(plan, registry, elementRefs);
    console.log(`[GeneratorAgent] Registry injection: ${elementRefs.size} element refs injected`);
  }

  // ── Step 5: Write properties files ────────────────────────────────────────
  const propertiesWriter = new PropertiesWriter();
  const writtenProps: string[] = [];

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

  // ── Step 6: Generate feature file via AI ───────────────────────────────────
  console.log(`\n[GeneratorAgent] Generating feature file via ${config.aiEnabled ? config.aiProvider : 'fallback'}...`);

  // Enrich AI with existing framework patterns — makes output match your app's style
  const frameworkContext = ContextEnricher.getFullContext(plan.page);
  console.log(`[GeneratorAgent] Framework context: ${frameworkContext ? 'loaded' : 'none available'}`);

  const prompt = GeneratePrompts.buildPrompt(plan, elementRefs, frameworkContext);
  const fallback = GeneratePrompts.buildFallback(plan, elementRefs);

  const featureContent = await LLMClient.askWithSystem(
    GeneratePrompts.SYSTEM_PROMPT,
    prompt,
    fallback
  );

  const isAIGenerated = featureContent !== fallback && featureContent.length > 0;
  console.log(`[GeneratorAgent] Feature file: ${isAIGenerated ? 'AI-generated' : 'fallback template'}`);

  // ── Step 7: Detect unresolved element refs in feature (warn, don't write TODOs) ─
  const unresolvedElements = _detectUnresolvedElements(featureContent, plan.page, registry, plan.url || '');
  if (unresolvedElements.length > 0) {
    const urlHint = plan.url ? `\n  Crawl the page: npm run agent:generate -- --plan ${args.plan} --url ${plan.url}` : '';
    console.warn(`\n[GeneratorAgent] ⚠️  ${unresolvedElements.length} element(s) referenced in feature but NOT in ${plan.page}.properties:`);
    unresolvedElements.forEach((key) => console.warn(`    - ${plan.page}.${key}`));
    console.warn(`  These elements need real locators before tests will pass.`);
    console.warn(`  Fix: Use Playwright MCP or provide --url to crawl the live DOM.${urlHint}\n`);
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
  const featurePath = featureWriter.write(featureContent, plan.page, sourceSuffix, args.apply);

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════');
  console.log('  Generator Agent — Complete');
  console.log('═══════════════════════════════════════════');

  if (writtenProps.length > 0) {
    console.log('  Properties files:');
    writtenProps.forEach((p) => console.log(`    ${p}`));
  } else {
    console.log('  Properties: No new elements — all existing refs reused');
  }

  console.log(`  Feature file: ${featurePath}`);
  console.log('');

  if (!args.apply) {
    console.log('  Review generated/features/ then apply:');
    console.log(`  npm run agent:generate -- --plan ${args.plan} --apply`);
  } else {
    console.log('  Applied to features/web/ — run: npm test');
  }
  console.log('═══════════════════════════════════════════\n');
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

function _resolveUrlsToCrawl(args: GeneratorArgs, plan: TestPlan): string[] {
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

function _injectFromRegistry(
  plan: TestPlan,
  registry: PropertiesRegistry,
  elementRefs: Map<string, string>
): void {
  const allPageNames = registry.getPageNames();
  const planPageLower = plan.page.toLowerCase();

  // 1. Direct page name match
  const directElements = registry.getPageElements(plan.page);
  directElements.forEach((el) => elementRefs.set(el.elementKey, el.ref));

  // 2. Fuzzy match — "Support" matches "CustomerSupport" and vice versa
  // IMPORTANT: use full "CustomerSupport.BtnSignIn" as key so AI knows exact page name to use
  allPageNames.forEach((pageName) => {
    if (pageName.toLowerCase() === planPageLower) return;
    const regPageLower = pageName.toLowerCase();
    if (regPageLower.includes(planPageLower) || planPageLower.includes(regPageLower)) {
      const els = registry.getPageElements(pageName);
      els.forEach((el) => elementRefs.set(`${pageName}.${el.elementKey}`, el.ref));
      console.log(`[GeneratorAgent] Fuzzy match: ${pageName} → ${els.length} elements injected as ${pageName}.*`);
    }
  });

  // 3. Navigation-referenced pages (e.g. Login → Dashboard → Orders)
  const navigationText = plan.testCases
    .map((tc) => `${tc.navigation} ${tc.steps.map((s) => s.action).join(' ')}`)
    .join(' ')
    .toLowerCase();

  allPageNames.forEach((pageName) => {
    const regPageLower = pageName.toLowerCase();
    if (regPageLower === planPageLower) return;
    if (navigationText.includes(regPageLower)) {
      const els = registry.getPageElements(pageName);
      els.forEach((el) => {
        if (!elementRefs.has(el.elementKey)) {
          elementRefs.set(`${pageName}.${el.elementKey}`, el.ref);
        }
      });
      console.log(`[GeneratorAgent] Navigation match: ${pageName} → ${els.length} elements injected`);
    }
  });
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
    console.log('[GeneratorAgent] ℹ️  Provide --url to auto-crawl real locators, or create the properties file manually using Playwright MCP.');
  }
  return [];
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
run().catch((err) => {
  console.error('[GeneratorAgent] Fatal error:', err);
  process.exit(1);
});
