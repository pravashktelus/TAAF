import * as fs from 'fs';
import * as path from 'path';
import { AgentsConfig } from '../config/AgentsConfig';
import { LLMClient } from '../core/LLMClient';
import { PageCrawler, PageSnapshot, DiscoveredElement } from '../core/PageCrawler';
import { PropertiesRegistry } from '../core/PropertiesRegistry';
import { ContextEnricher } from '../core/ContextEnricher';
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
      if (crawledSnapshots.size > 0) {
        const mainSnapshot = [...crawledSnapshots.values()][0];
        const navLinks = mainSnapshot.navigationLinks || [];
        const neededPages = new Set<string>();

        // Parse navigation flow from plan (e.g. "Home → Login → Products → View Product → Cart")
        const navFlow = (plan as any).navigationFlow || '';
        if (navFlow) {
          const flowSteps = navFlow.split(/\s*[→>]\s*/).map((s: string) => s.trim().toLowerCase());
          flowSteps.forEach((step: string) => {
            if (step.includes('login') || step.includes('signup')) neededPages.add('login');
            if (step.includes('product') && (step.includes('detail') || step.includes('view'))) neededPages.add('product_details');
            if (step.includes('cart')) neededPages.add('view_cart');
            if (step.includes('contact')) neededPages.add('contact_us');
          });
          console.log(`[GeneratorAgent] Navigation flow: "${navFlow}" → pages to crawl: ${[...neededPages].join(', ') || 'none additional'}`);
        }

        // Also check test case actions for pages not covered by nav flow
        plan.testCases.forEach((tc) => {
          tc.steps.forEach((s) => {
            const a = s.action.toLowerCase();
            if (a.includes('login') || a.includes('signup')) neededPages.add('login');
            if (a.includes('product') && (a.includes('detail') || a.includes('view'))) neededPages.add('product_details');
            if (a.includes('cart')) neededPages.add('view_cart');
          });
        });

        if (neededPages.size > 0 && navLinks.length > 0) {
          const baseUrl = new URL(urlsToCrawl[0]).origin;
          for (const needed of neededPages) {
            const link = navLinks.find((l) => l.href.toLowerCase().includes(needed.replace('_', '')));
            if (link && link.href) {
              const fullUrl = link.href.startsWith('http') ? link.href : `${baseUrl}${link.href}`;
              console.log(`[GeneratorAgent] Auto-crawling related page: ${fullUrl}`);
              try {
                const relatedSnapshot = await crawler!.crawl(fullUrl);
                // Merge new elements into main snapshot
                relatedSnapshot.elements.forEach((el) => {
                  if (!mainSnapshot.elements.some((e) => e.locator === el.locator)) {
                    mainSnapshot.elements.push(el);
                  }
                });
                console.log(`[GeneratorAgent] → +${relatedSnapshot.elements.length} elements from ${needed} page`);
              } catch (err) {
                console.warn(`[GeneratorAgent] Could not crawl ${fullUrl}: ${err}`);
              }
            }
          }
        }
      }
    } finally {
      if (crawler) await crawler.close();
    }
  } else if (plan.url && plan.url.startsWith('http')) {
    // No --url flag but plan has a URL — try loginAndNavigate
    console.log(`[GeneratorAgent] No --url flag but plan has URL. Attempting login + navigate to: ${plan.url}`);
    try {
      crawler = new PageCrawler();
      await crawler.launch();
      const targetSnapshot = await crawler.loginAndNavigate(plan.url);
      if (!targetSnapshot.url.includes('login')) {
        crawledSnapshots.set(plan.page, targetSnapshot);
        console.log(`[GeneratorAgent] ✅ Reached ${plan.page} page: ${targetSnapshot.elements.length} elements captured`);
      } else {
        console.warn(`[GeneratorAgent] ⚠️  Login failed — using registry only`);
      }
    } finally {
      if (crawler) await crawler.close();
    }
  } else {
    console.log('[GeneratorAgent] No URLs provided — using registry elements only');
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
    console.log(`[GeneratorAgent] Element map from crawl: ${elementRefs.size} refs`);
  }

  // ALWAYS inject from registry — complements crawled elements with existing refs
  // This ensures the deterministic step mapper can find Login, Nav, Dashboard elements
  _injectFromRegistry(plan, registry, elementRefs);
  console.log(`[GeneratorAgent] Element map total (crawl + registry): ${elementRefs.size} refs`);


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

  // ── Step 6: Generate feature file (per-AC AI calls or deterministic fallback) ─
  console.log(`\n[GeneratorAgent] Generating feature file...`);

  const frameworkContext = ContextEnricher.getFullContext(plan.page);
  console.log(`[GeneratorAgent] Framework context: ${frameworkContext ? 'loaded' : 'none available'}`);

  let featureContent: string;

  if (config.aiEnabled) {
    // ── AI MODE: Generate steps per-AC with focused prompts ──────────────
    console.log(`[GeneratorAgent] Using per-AC AI generation (${config.aiProvider})...`);
    const moduleName = plan.page.toLowerCase();
    const featureLines: string[] = [];

    featureLines.push(`@web @${moduleName}_web`);
    featureLines.push(`Feature: ${plan.page} - ${plan.sourceFile?.replace(/\.[^.]+$/, '') || 'Generated Feature'}`);
    featureLines.push(`  As a user`);
    featureLines.push(`  I want to interact with the ${plan.page} page`);
    featureLines.push('');

    // Build available elements list for AI context
    const allElements = [...elementRefs.values()];

    for (const tc of plan.testCases) {
      const tags = tc.type === 'negative' ? '@negative @regression' : '@smoke @e2e';
      featureLines.push(`  ${tags}`);
      featureLines.push(`  Scenario: ${tc.id} ${tc.title}`);
      featureLines.push(`    Given I navigate to the application`);

      // Filter elements relevant to THIS AC's keywords (max 40)
      const acKeywords = tc.steps
        .map((s) => `${s.action} ${s.expected}`.toLowerCase())
        .join(' ')
        .split(/[\s'".,;:!?]+/)
        .filter((w) => w.length > 3);
      
      const relevantElements = allElements.filter((ref) => {
        const refLower = ref.toLowerCase();
        // Always include inputs, buttons, and selects
        if (refLower.includes('input') || refLower.includes('btn') || refLower.includes('select')) return true;
        // Include if any AC keyword matches
        return acKeywords.some((kw) => refLower.includes(kw));
      }).slice(0, 40);

      // If too few matched, include the first 30 elements as general context
      const availableElements = relevantElements.length >= 5 
        ? relevantElements.map((ref) => `  '${ref}'`)
        : allElements.slice(0, 30).map((ref) => `  '${ref}'`);

      // Per-AC AI call
      const acPrompt = GeneratePrompts.buildPerACPrompt(tc, plan.page, availableElements);
      const deterministicFallback = tc.steps.map((s) => {
        const mapped = GeneratePrompts['_mapStepToGherkin'](s, plan.page, elementRefs);
        return mapped.filter((l: string) => !l.startsWith('#')).map((l: string) => `    ${l}`).join('\n');
      }).join('\n');

      const aiSteps = await LLMClient.askWithSystem(
        'You are a BDD automation expert. Output ONLY Gherkin steps — no explanation, no markdown, no headers.',
        acPrompt,
        deterministicFallback
      );

      // Parse AI response — each line should be a step
      const stepLines = aiSteps
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.match(/^(When|Then|And|But|Given)\s/i))
        .map((l) => `    ${l}`);

      if (stepLines.length > 0) {
        featureLines.push(...stepLines);
      } else {
        // AI returned nothing usable — use deterministic
        featureLines.push(deterministicFallback);
      }

      featureLines.push('');
    }

    featureContent = featureLines.join('\n');
    console.log(`[GeneratorAgent] Feature file generated via per-AC AI (${plan.testCases.length} scenarios)`);

  } else {
    // ── FALLBACK: deterministic step mapper ──────────────────────────────
    featureContent = GeneratePrompts.buildFallback(plan, elementRefs);
    console.log(`[GeneratorAgent] Feature file generated via deterministic mapper (no AI)`);
  }
  // ── Step 7: Detect unresolved element refs in feature (warn, don't write TODOs) ─
  const unresolvedElements = _detectUnresolvedElements(featureContent, plan.page, registry, plan.url || '');
  if (unresolvedElements.length > 0) {
    const urlHint = plan.url ? `\n  Crawl the page: npm run agent:generate -- --plan ${args.plan} --url ${plan.url}` : '';
    console.warn(`\n[GeneratorAgent] ⚠️  ${unresolvedElements.length} element(s) referenced in feature but NOT in ${plan.page}.properties:`);
    unresolvedElements.forEach((key) => console.warn(`    - ${plan.page}.${key}`));
    console.warn(`  These elements need real locators before tests will pass.`);
    console.warn(`  Fix: Use Playwright MCP or provide --url to crawl the live DOM.${urlHint}\n`);
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

  // Always include TeleConnect (login page) — almost every flow starts with login
  if (!navigationText.includes('teleconnect')) {
    const loginKeywords = ['login', 'sign in', 'sign-in', 'credentials', 'email', 'password'];
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
