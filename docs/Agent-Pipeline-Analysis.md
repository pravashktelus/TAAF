# Agent Pipeline — Complete Analysis

**Date:** August 11, 2026  
**Version:** Base (current production code)

---

## 1. Architecture Overview

```
src/agents/
├── config/
│   └── AgentsConfig.ts          ← Reads framework.properties + .env
├── core/
│   ├── LLMClient.ts             ← Multi-provider AI (OpenAI/Anthropic/Ollama)
│   ├── PageCrawler.ts           ← Playwright browser for DOM extraction
│   ├── PropertiesRegistry.ts    ← Loads existing .properties into memory
│   └── ContextEnricher.ts       ← Reads existing features/properties as AI context
├── planner/
│   ├── PlannerAgent.ts          ← CLI: npm run agent:plan
│   ├── StoryReader.ts           ← Reads .md/.xlsx/.pdf/.docx
│   ├── PlanPrompts.ts           ← AI prompts for plan generation
│   └── PlanFormatter.ts         ← Parses AI response → plan.json + plan.md
├── generator/
│   ├── GeneratorAgent.ts        ← CLI: npm run agent:generate
│   ├── GeneratePrompts.ts       ← AI prompts for feature generation
│   ├── PropertiesWriter.ts      ← Writes/appends .properties files
│   └── FeatureWriter.ts         ← Writes .feature files
└── healer/
    └── HealerAgent.ts           ← CLI: npm run agent:heal
```

### Pipeline Flow

```
User Story (.md)
       ↓
┌──────────────────────────────────────────────┐
│ PLANNER (npm run agent:plan)                 │
│ StoryReader → PageCrawler → AI → PlanFormatter│
│ Output: generated/plans/{Page}-plan.json     │
└──────────────────────┬───────────────────────┘
                       ↓
┌──────────────────────────────────────────────┐
│ GENERATOR (npm run agent:generate)           │
│ Plan JSON → PageCrawler → AI → Writers       │
│ Output: .properties + .feature files         │
└──────────────────────┬───────────────────────┘
                       ↓
┌──────────────────────────────────────────────┐
│ TEST EXECUTION (npm test)                    │
│ Cucumber → ElementResolver → ActionEngine    │
│ SelfHealingEngine → RCA                      │
└──────────────────────┬───────────────────────┘
                       ↓
┌──────────────────────────────────────────────┐
│ HEALER (npm run agent:heal)                  │
│ ReportReader → FailureClassifier → Report    │
│ Output: generated/reports/healing-report.md  │
└──────────────────────────────────────────────┘
```

---

## 2. File-by-File Code Walkthrough

### AgentsConfig.ts — Configuration
Singleton that reads `framework.properties` + `.env`. Exposes typed getters for AI provider, model, credentials, XLS column mappings, app URL, browser type. Loads API keys from environment.

**Status:** ✅ Solid — no issues.

---

### StoryReader.ts — Input Reading
Reads stories from `requirements/stories/` or test cases from `requirements/testcases/`. Supports .md, .txt, .docx (via mammoth), .pdf (via pdf-parse), .xlsx (via xlsx library). Auto-detects mode (story vs testcases) using regex heuristics. Loads attachments from `requirements/stories/attachments/{storyName}/`.

For XLS: parses rows using configurable column headers (`agents.xls.col.*`), groups multi-row test cases by TC ID with carry-forward.

**Status:** ✅ Well-engineered — handles all input formats correctly.

---

### PageCrawler.ts — DOM Element Extraction
Launches headless Playwright browser, navigates to a URL, runs `page.evaluate()` to scan all interactive elements. Locator priority: `data-testid > id > placeholder > aria-label > text > css`.

Key methods:
- `launch()` / `close()` — browser lifecycle
- `crawl(url)` — navigate + extract elements + nav links + forms + rawHTML
- `login()` — tries common login field selectors
- `replaySteps()` — attempts to follow test case steps by fuzzy-matching elements
- `_extractElements()` — the core DOM scanner

**Status:** ⚠️ Partially working — see Flaws section.

---

### LLMClient.ts — AI Communication
Simple provider switch: OpenAI (default), Anthropic, Ollama. If AI unavailable (no key / API failure) → returns caller-provided fallback string silently. Uses `askWithSystem()` for system+user prompt pairs.

**Status:** ✅ Clean, handles failures gracefully.

---

### PropertiesRegistry.ts — Existing Locator Lookup
Scans all `.properties` files at startup, builds in-memory map of `pageName → key → locator → ref`. `findMatch()` checks if exact locator already exists for that page → returns `source: 'existing'` (reuse) or `source: 'new'` (write).

**Status:** ✅ Works correctly.

---

### PlannerAgent.ts — Planner CLI
Orchestrates: parse args → read story → crawl page → match elements against registry → build AI prompt → send to LLM → format output.

Two paths:
- **Testcases mode** (structured XLS): Bypasses AI entirely — uses parsed test cases directly. Reliable.
- **Story mode** (free-form .md): Sends full story + elements to AI → AI generates test cases. Unreliable.

**Status:** ⚠️ Works well for testcases mode. Story mode depends on AI quality.

---

### PlanPrompts.ts — AI Prompts for Planning
Builds prompts for AI. Story mode tells AI to "generate comprehensive test cases" including happy path, negative, edge cases. Testcases mode tells AI to "preserve every single step" and just reformat.

**Status:** ⚠️ Testcases mode prompt is strict and effective. Story mode prompt gives AI too much freedom.

---

### PlanFormatter.ts — Plan Output
Parses AI JSON response, enriches with metadata (timestamp, source), writes `plan.json` (machine-readable) + `plan.md` (human-readable with tables). Handles malformed AI responses gracefully.

**Status:** ✅ Solid infrastructure.

---

### GeneratorAgent.ts — Generator CLI
The most complex agent. Steps:
1. Read plan JSON
2. Load PropertiesRegistry
3. Resolve URLs to crawl (from --url, --urls, plan.url, or extracted from steps)
4. Crawl each URL → get snapshots
5. Build element map (crawled + registry injected via fuzzy matching)
6. Write new elements to .properties via PropertiesWriter
7. Send test cases + elements to AI → get feature file
8. Parse feature for new `Page.Element` refs → write TODO locators
9. Write feature file

**Status:** ❌ Multiple critical flaws — see below.

---

### GeneratePrompts.ts — AI Prompts for Feature Generation
Builds a massive prompt with: step patterns (40+), conventions, element references (100+), page naming rules, test cases, and "Your Task" instructions. The system prompt says "output ONLY valid Gherkin."

**Status:** ❌ Prompt too large/complex for reliable AI output.

---

### PropertiesWriter.ts — File Writer
Creates or appends to `.properties` files. Groups elements by type (Buttons, Inputs, Navigation, etc.). Checks for duplicate keys before appending. Never overwrites existing entries.

**Status:** ⚠️ Core logic fine, but writes TODO placeholder locators when called with invalid data.

---

### FeatureWriter.ts — Feature File Writer
Writes `.feature` content to `generated/features/` (review) or `features/web/` (with --apply). Simple file I/O.

**Status:** ✅ No issues.

---

### ContextEnricher.ts — Framework Pattern Context
Reads existing `.feature` and `.properties` files to give AI examples of your app's coding style. Sorts by relevance (page name fuzzy match). Truncates to keep prompt manageable.

**Status:** ✅ Good idea, but adds to prompt bloat for Generator.

---

### HealerAgent.ts — Post-Run Analysis
Reads `cucumber-report.json`, delegates to `ReportReader` + `FailureClassifier` + `HealingReportWriter`. Classifies each failure as: `app_fault` / `test_fault` / `healed` / `review`.

**Status:** ✅ Works correctly — accurate classifications and actionable reports.

---

## 3. Self-Healing & RCA — Working Correctly

Self-Healing and RCA work properly when given valid inputs:

- **Self-Healing** triggers when a locator that was PREVIOUSLY VALID fails at runtime (locator drift). It scans the DOM for alternatives using XPath generation, OpenAI suggestions, and CSS class matching. When it finds the element, it caches the healed locator and attaches an HTML report to the test step.

- **RCA (Root Cause Analysis)** uses OpenAI to analyze failures, providing: error explanation, possible root causes, and suggested fixes. Attached to failed scenarios automatically.

**The problem is NOT self-healing or RCA.** The problem is that the Generator writes `# TODO: Add locator for X` as the locator VALUE in `.properties` files. This is not a valid locator — self-healing cannot recover from a locator that was never valid. Self-healing is designed for locator *drift* (was valid → became stale), not locator *absence*.

---

## 4. Current Capability Matrix

| Component | What Works | What Doesn't |
|---|---|---|
| **StoryReader** | All formats (.md, .xlsx, .pdf, .docx), mode detection, attachments | — |
| **PageCrawler** | Single-page crawl, element extraction, login | Multi-page flows, dynamic content, `data-qa` attributes |
| **Planner (testcases mode)** | Direct passthrough of XLS test cases — 100% accurate | — |
| **Planner (story mode)** | Produces structured JSON plan | AI invents/modifies test cases vs story ACs |
| **Generator (crawl → .properties)** | Writes real locators from crawled DOM | Single page only, ambiguous locators |
| **Generator (AI → .feature)** | Produces a .feature file | AI ignores plan, invents scenarios, wrong elements |
| **Generator (TODO → .properties)** | — | Writes `# TODO:` as locator values → breaks runtime |
| **Self-Healing** | Recovers from locator drift perfectly | Cannot fix never-valid locators |
| **RCA** | Accurate failure analysis + suggestions | — |
| **Healer** | Classifies failures, actionable reports | — |

---

## 5. Identified Flaws

### FLAW 1: PageCrawler — Single Page Only
`crawl(url)` visits ONE page and returns. For a story involving login → products → product details → cart (4+ pages), only one gets crawled.

**Impact:** Missing elements → Generator writes TODO placeholders → tests fail.

### FLAW 2: PageCrawler — Ambiguous Locators
For links uses `text=Cart` (matches 71 "Add to cart" buttons). For inputs uses `placeholder=Email Address` (matches 3 inputs on login page). No `data-qa` attribute support (automationexercise.com uses `data-qa` not `data-testid`).

**Impact:** Strict mode violations at runtime — Playwright refuses to act on ambiguous selectors.

### FLAW 3: Generator — Writes TODO Locator Values
`_extractTodoElements()` in GeneratorAgent.ts (line ~120) writes:
```properties
SearchResults=# TODO: Add locator for SearchResults | Verify at: https://...
```
`ElementResolver` at runtime passes this string to Playwright → crash → self-healing triggers → heals to wrong element.

**Impact:** Every element not found during single-page crawl gets a poison locator.

### FLAW 4: Generator — AI Feature Generation Unreliable
`GeneratePrompts.buildPrompt()` sends 3000+ tokens with 100+ element refs, 40+ step patterns, and test cases. GPT-4-turbo:
- Invents its own scenarios instead of following plan
- Uses wrong page names (mixes Login, Products, ProductSearch)
- Appends `# TODO` comments to step lines (breaks Cucumber regex matching)

**Impact:** Generated .feature file doesn't match user story. Tests fail immediately.

### FLAW 5: Generator — Convention Elements Fallback
`_buildConventionElements()` creates fake element keys from action keywords (e.g., "Click login button" → `BtnLogin`) with TODO locators. These are guesses, not real elements.

**Impact:** Properties file bloated with invalid entries.

### FLAW 6: Planner — Story Mode AI Hallucinates
In story mode, AI generates test cases freely. Even with explicit acceptance criteria (AC-1 through AC-7), AI produces 3-4 different scenarios with different titles and steps.

**Impact:** Plan JSON doesn't match story → Generator builds wrong feature.

---

## 6. What Works End-to-End Today

The pipeline SUCCEEDS when:
1. Input is structured XLS test cases (testcases mode bypasses AI for planning)
2. ALL pages are crawled (real locators, no TODOs)
3. The application uses `data-testid` attributes (crawler priority #1)
4. Feature file is manually reviewed before `--apply`

The pipeline FAILS when:
1. Input is a user story (.md) with acceptance criteria (AI hallucinates)
2. Only one URL is crawled (most elements missing)
3. Application uses `data-qa` instead of `data-testid` (crawler misses them)
4. `--apply` is used without reviewing output

---

## 7. The Key Gap: Playwright MCP vs PageCrawler

### With Kiro + Playwright MCP (works):
Kiro can navigate each page, interact (fill forms, click buttons), snapshot the DOM, and extract precise locators (`data-qa='login-email'`, `#search_product`). This produces a `.properties` file with every locator verified → tests pass → self-healing handles future drift.

### With Agent Pipeline from CMD (fails):
The `PageCrawler` class is a basic single-page DOM scraper. It cannot:
- Navigate multi-page flows (login → signup → products → cart)
- Fill forms and submit to reach authenticated pages
- Click buttons to reveal modals or dynamic content
- Distinguish between `data-qa` and `data-testid` attributes
- Chain interactions to progress through a user journey

**This is the core gap.** The agent pipeline needs Playwright MCP-level navigation capability built into the `PageCrawler` — the ability to follow the story's navigation flow, interact with each page, and extract locators from each step.

---

## 8. Recommended Fixes (Priority Order)

### P1: Make PageCrawler Multi-Page Capable
- Accept multiple URLs via `--urls` flag (already parsed but not fully working)
- Crawl each URL independently and merge elements
- Add `data-qa` to the locator priority list (many apps use it)
- Prefer `//a[@href='/path']` for links over `text=Label`

### P2: Stop Writing TODO Locator Values
- `_extractTodoElements()` should NEVER write to .properties
- Instead: warn the user and skip the element
- Or: fail the pipeline entirely if >50% of elements are unresolved

### P3: Replace AI Feature Generation with Deterministic Template
- Build feature skeleton in code (tags, scenarios, titles from plan JSON)
- Use AI only for individual step mapping (short focused prompts)
- Rule-based fallback for common patterns (click/enter/verify)

### P4: Improve Planner Story Mode
- Parse acceptance criteria (AC-1, AC-2...) deterministically using regex
- Use parsed ACs as test case structure — don't let AI invent scenarios
- Only use AI for generating step details within each AC

### P5: Add Output Validation Gate
- Before `--apply`: verify scenario count matches plan
- Verify all `Page.Element` refs exist in .properties
- Reject files with TODO locator values
- Reject steps with appended comments

---

## 9. Summary

The agent pipeline infrastructure is solid — file reading, crawling, registry matching, AI communication, and reporting all work. The **two critical blockers** are:

1. **PageCrawler cannot navigate multi-page flows** → produces incomplete .properties with TODO placeholders → tests fail
2. **AI feature generation is unreliable** → generates wrong scenarios/elements → tests fail

Self-healing and RCA work perfectly when given valid locators. The fix path is clear: enhance PageCrawler for multi-page navigation (giving it Playwright MCP-level capability), eliminate TODO locator writes, and replace monolithic AI generation with deterministic templates + focused AI calls.
