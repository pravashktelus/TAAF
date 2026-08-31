# AI Agent Pipeline — Technical Documentation

## Overview

The AI Agent Pipeline is a 3-agent system that automates BDD test script creation from user stories. It transforms natural-language requirements into executable Cucumber/Gherkin test scenarios with element locators captured from live application DOM.

```
User Story (.md) → [Planner Agent] → Plan JSON → [Generator Agent] → .properties + .feature → [npm test] → [Healer Agent] → Healing Report
```

---

## Architecture

### Module Structure

```
src/agents/
├── config/
│   └── AgentsConfig.ts              ← Singleton config (reads framework.properties + .env)
├── core/                            ← Shared infrastructure
│   ├── LLMClient.ts                 ← Multi-provider AI client (OpenAI / Anthropic / Ollama)
│   ├── PlaywrightCrawler.ts         ← Browser automation for live DOM crawling + step replay
│   ├── PageCrawler.ts               ← Alternative element extraction engine
│   ├── PropertiesRegistry.ts        ← In-memory index of all existing .properties locators
│   ├── OutputValidator.ts           ← Validates generated features before deployment
│   ├── ContextEnricher.ts           ← Injects existing framework patterns into AI prompts
│   └── StepPatternExtractor.ts      ← Extracts step regex patterns from step definition files
├── planner/                         ← Phase 1: Story → Plan
│   ├── PlannerAgent.ts              ← CLI entry + orchestration
│   ├── StoryReader.ts               ← Multi-format story parser (.md/.docx/.pdf/.xlsx)
│   ├── PlanPrompts.ts               ← AI prompt construction + deterministic AC parser
│   └── PlanFormatter.ts             ← Formats output → JSON + Markdown plan files
├── generator/                       ← Phase 2: Plan → Test Scripts
│   ├── GeneratorAgent.ts            ← CLI entry + orchestration
│   ├── GeneratePrompts.ts           ← Per-AC prompt builder + step pattern mapper
│   ├── PropertiesWriter.ts          ← Writes/appends element locator files
│   └── FeatureWriter.ts             ← Writes Gherkin feature files
└── healer/                          ← Phase 3: Post-run failure analysis
    ├── HealerAgent.ts               ← CLI entry + classification orchestration
    ├── ReportReader.ts              ← Parses cucumber JSON reports
    ├── FailureClassifier.ts         ← Rule-based failure categorization
    └── HealingReportWriter.ts       ← Generates healing report (MD + JSON)
```

### NPM Scripts

| Command | Description |
|---------|-------------|
| `npm run agent:plan` | Run Planner Agent |
| `npm run agent:generate` | Run Generator Agent |
| `npm run agent:heal` | Run Healer Agent |

---

## Phase 1: Planner Agent

### Purpose
Converts a user story into a structured test plan (JSON) with test cases, steps, test data, and discovered page elements.

### Command
```bash
npm run agent:plan -- --story "requirements/stories/MyStory.md" --page PageName --url "https://app.com/login"
```

### Processing Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│ Step 1: Read Story Input                                            │
│   StoryReader.readStory(file) → {mode, mainContent, attachments}    │
│   Supports: .md, .docx, .pdf, .xlsx                                 │
│   Auto-detects mode: story (has ACs) vs testcases (has step tables) │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 2: Crawl Live Application (if --url provided)                  │
│   a. Extract replayable steps from story text                       │
│      _extractStoryStepsForReplay(content) → [{action, testData}]    │
│      Parses: Navigate, Enter, Click, Select, Check patterns         │
│                                                                     │
│   b. PlaywrightCrawler.replaySteps(steps, appUrl)                   │
│      - Launches headless browser                                    │
│      - Navigates to starting URL                                    │
│      - For each step: smart-fills forms, clicks buttons             │
│      - Snapshots page at each URL transition                        │
│      - Uses _smartFill/_smartClick with data-testid/placeholder     │
│      - Generates realistic test data for forms (email, name, etc.)  │
│                                                                     │
│   c. Merge all page snapshots into single element set               │
│      - Each snapshot has: url, title, elements[], navLinks, forms   │
│      - Elements include: key, locator, type, label, tag             │
│                                                                     │
│   d. Match against PropertiesRegistry                               │
│      - Existing locator → source: 'existing', reuse ref            │
│      - New locator → source: 'new', assign PageName.ElementKey      │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 3: Generate Test Cases                                         │
│                                                                     │
│   Path A (Deterministic — when ACs found):                          │
│     PlanPrompts._parseAcceptanceCriteria(content)                   │
│     → Extracts ACs directly from story (no AI hallucination)        │
│     → Maps each AC title + steps to a test case                     │
│     → Optional: AI generates supplementary negative/edge cases      │
│                                                                     │
│   Path B (AI — when no explicit ACs):                               │
│     PlanPrompts.buildStoryPrompt(story, page, snapshot, context)    │
│     → Full AI generation with story + live page elements as context │
│     → LLMClient.askWithSystem(SYSTEM_PROMPT, prompt, fallback)      │
│                                                                     │
│   Path C (Fallback — AI unavailable):                               │
│     PlanPrompts.buildStoryFallback(page, snapshot, content)         │
│     → Template-based minimal plan                                   │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 4: Preserve Crawled Elements                                   │
│   Always overrides AI-generated elements with original crawled      │
│   elements (AI tends to modify casing/locator strings)              │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 5: Write Output                                                │
│   PlanFormatter.format(response, page, sourceFile)                  │
│   → generated/plans/{Page}-plan_from_{Source}.json (for Generator)  │
│   → generated/plans/{Page}-plan_from_{Source}.md  (for QA review)   │
└─────────────────────────────────────────────────────────────────────┘
```

### Plan JSON Structure

```json
{
  "page": "AutomationExerciseRegisterCart",
  "url": "https://automationexercise.com",
  "navigationFlow": "Home → Signup → Register → Products → Cart",
  "mode": "story",
  "aiGenerated": false,
  "generatedAt": "2026-08-26T07:00:00.000Z",
  "sourceFile": "requirements/stories/MyStory.md",
  "testData": { "name": "##FullName", "email": "##Email" },
  "elements": [
    { "key": "InputSignupEmail", "locator": "//input[@data-qa='signup-email']", "type": "input", "label": "Email Address", "tag": "input" }
  ],
  "testCases": [
    {
      "id": "TC-001",
      "title": "Register and add product to cart",
      "type": "happy_path",
      "steps": [
        { "stepNo": 1, "action": "Navigate to the application", "testData": "", "expected": "Page loaded" },
        { "stepNo": 2, "action": "Click \"Signup / Login\" in navigation", "testData": "", "expected": "" }
      ]
    }
  ]
}
```

---

## Phase 2: Generator Agent

### Purpose
Transforms a plan JSON into executable test artifacts: `.properties` file (element locators) and `.feature` file (Gherkin scenarios).

### Command
```bash
npm run agent:generate -- --plan "generated/plans/MyPage-plan.json" --apply
```

### Processing Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│ Step 1: Read Plan JSON                                              │
│   Load plan from generated/plans/                                   │
│   Detect mode: Web UI vs API                                        │
│   Extract test cases, elements, test data                           │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 2: Load Properties Registry                                    │
│   PropertiesRegistry.load()                                         │
│   Scans all src/pages/properties/*.properties files                 │
│   Builds in-memory index: {pageName, elementKey, locator, ref}      │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 3: Crawl Live Pages (conditional)                              │
│   SKIPPED if: plan already has elements, OR it's API mode           │
│   If crawling:                                                      │
│     - Navigate to each URL                                          │
│     - Replay test case steps to discover all pages                  │
│     - Detect login redirects → auto-login → re-navigate             │
│     - Filter elements by story relevance (keyword matching)         │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 4: Build Element Map                                           │
│   For each discovered element:                                      │
│     PropertiesRegistry.findMatch(locator, page, key)                │
│     → existing: reuse existing ref (e.g., 'TeleConnect.BtnLogin')   │
│     → new: mark for .properties creation                            │
│                                                                     │
│   _injectFromRegistry():                                            │
│     - Direct page name match                                        │
│     - Fuzzy match (e.g., "Support" matches "CustomerSupport")       │
│     - Navigation-referenced pages (Login elements if flow has login)│
│     - Cross-domain protection (skip foreign app locators)           │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 5: Write Properties File                                       │
│   PropertiesWriter.write(pageName, elements)                        │
│   → src/pages/properties/{PageName}.properties                      │
│   Groups elements by type: Buttons, Inputs, Navigation, Other       │
│   Only writes NEW elements (never overwrites existing)              │
│                                                                     │
│   Example output:                                                   │
│   # PageName - Buttons                                              │
│   BtnLogin=//button[@data-qa='login-button']                        │
│   # PageName - Input Fields                                         │
│   InputEmail=//input[@data-qa='signup-email']                        │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 6: Generate Feature File (Per-AC AI)                           │
│                                                                     │
│   For EACH test case in the plan:                                   │
│     a. Filter available elements relevant to this AC                │
│     b. Build focused prompt with:                                   │
│        - Test case steps + expected results                         │
│        - Available elements with exact locators                     │
│        - Step patterns from WebSteps.ts/CommonSteps.ts              │
│        - ## random data syntax + $$ variable syntax                 │
│     c. LLMClient.askWithSystem(systemPrompt, acPrompt, fallback)    │
│     d. Parse AI response → extract Gherkin step lines               │
│     e. Validate element refs against known elements                 │
│     f. Fuzzy-match hallucinated refs → closest valid element        │
│     g. Strip lines with unresolvable refs                           │
│                                                                     │
│   _postFixFeature(): Auto-corrects 12+ common AI mistakes           │
│   - "page url should contain" → "url should contain"               │
│   - "should be displayed" → "should be visible"                    │
│   - Removes duplicate navigation steps                              │
│   - Fixes API step patterns                                        │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 7: Validate Output                                             │
│   OutputValidator.validate(featureContent, plan, isApply)           │
│   Checks:                                                           │
│     ✓ Scenario count matches plan test case count                   │
│     ✓ All 'Page.Element' refs exist in .properties registry         │
│     ✓ No TODO locator values in referenced .properties              │
│     ✓ No malformed step lines (inline comments)                     │
│   Blocks --apply if errors found                                    │
│   Strips unresolved element refs from feature                       │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 8: Write Feature File + Mask Credentials                       │
│   _maskCredentialsInFeature():                                      │
│     - Detects real credentials in enter/type steps                  │
│     - Skips ## tokens and $$ variables (framework syntax)           │
│     - Replaces with $$email, $$password, $$username                 │
│     - Saves actual values to testdata/runtime-store.json            │
│                                                                     │
│   FeatureWriter.write():                                            │
│     Without --apply: generated/features/{page}_from_{source}.feature│
│     With --apply:    features/web/{page}_from_{source}.feature      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Phase 3: Healer Agent

### Purpose
Analyzes test execution reports and classifies failures into actionable categories.

### Command
```bash
npm run agent:heal
```

### Classification Categories

| Category | Meaning | Action |
|----------|---------|--------|
| `app_fault` | Real application bug | Raise defect |
| `test_fault` | Stale locator or wrong step | Update .properties file |
| `healed` | Self-healed at runtime | Persist the healed locator |
| `review` | Ambiguous failure | Manual investigation |

### Classification Rules
1. Assertion failure (expected vs received mismatch) → `app_fault`
2. API status code wrong → `app_fault`
3. Self-healing screenshots exist for scenario → `healed`
4. Locator timeout / element not found → `test_fault`
5. Navigation/URL mismatch → `review`
6. AI fallback for ambiguous cases (if `--ai` flag)

---

## Core Infrastructure

### LLMClient — Multi-Provider AI

Supports three LLM providers via a single interface:

| Provider | Model | Key Required |
|----------|-------|--------------|
| `openai` (default) | gpt-4-turbo | `OPENAI_API_KEY` in .env |
| `anthropic` | claude-3-5-sonnet | `ANTHROPIC_API_KEY` in .env |
| `ollama` | llama3 (local) | None (runs locally) |

**Fallback behavior:** If AI is unavailable (no key, API error, disabled), returns the caller-provided fallback string. Agents always produce output.

### PlaywrightCrawler — Element Discovery

The production browser crawler that captures element locators from live pages:

1. **Accessibility Tree Extraction** — Uses Playwright's accessibility snapshot to discover all interactive elements regardless of scroll position
2. **Data-Attribute Priority** — `data-testid` > `data-test` > `data-qa` > `data-cy` (highest stability locators)
3. **DOM Property Usage** — Uses `.placeholder` DOM property (not `getAttribute`) for correct casing
4. **Step Replay** — Walks through the application by replaying story steps (click, fill, select) to reach all pages in a multi-page flow
5. **Smart Interaction** — `_smartFill()` uses fallback chain: data-qa → placeholder → aria-label → text content; prefers `.last()` to handle duplicate fields (e.g., login + signup both having email)
6. **Navigation Detection** — `waitForURL` after clicks to detect page transitions, captures snapshot at each new URL

### PropertiesRegistry — Locator Management

In-memory index of all element locators:
- **Load:** Scans `src/pages/properties/*.properties`, parses `Key=locator` entries
- **Match:** `findMatch(locator, page, key)` — exact locator comparison (case-sensitive), case-insensitive page name
- **Reuse:** If a crawled element's locator already exists in the registry, reuse the existing `PageName.Key` reference

### OutputValidator — Quality Gate

Validates generated `.feature` files before deployment:
- Blocks `--apply` if element refs don't resolve to existing `.properties` entries
- Detects TODO/placeholder locator values
- Catches inline comments that break Cucumber regex matching
- Reports validation as errors (blocking) vs warnings (informational)

---

## Configuration

All agent settings live in `src/config/framework.properties`:

```properties
# Master toggle
agents.enabled=true

# AI provider: openai | anthropic | ollama
agents.ai.provider=openai
agents.ai.model=gpt-4-turbo

# Output directory for generated artifacts
agents.output.dir=generated
```

API keys in `features/.env`:
```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Data Syntax (in Feature Files)

| Syntax | Purpose | Example |
|--------|---------|---------|
| `##FullName` | Random data (Faker.js) | Generates "Jane Doe" at runtime |
| `##Email` | Random email | Generates "user@example.com" |
| `##MobileNum` | Random phone | Generates "9876543210" |
| `{varName}` | Scenario variable | Set via `store as` step |
| `$$varName` | Cross-scenario variable | Persisted to runtime-store.json |

Available `##` tokens: FullName, FirstName, LastName, Email, Username, Password, MobileNum, PhoneNum, Address, City, State, ZipCode, Country, Company, JobTitle, DOB, SSN, CreditCard, Amount, UUID

---

## Key Design Decisions

1. **AI is optional** — Every agent has a deterministic fallback path. AI enhances quality but isn't required.
2. **Step replay over static crawl** — Replays user story steps through the live app to discover all pages in multi-page flows.
3. **Never overwrite locators** — PropertiesWriter only appends/creates, preserving manually-tuned locators.
4. **Review-first workflow** — Generated features go to `generated/features/` by default; `--apply` is explicit.
5. **Credential masking** — Real credentials replaced with `$$variable` references; actual values stored separately.
6. **Per-AC generation** — AI called once per test case (not full feature) for focused, accurate output.
7. **Cross-domain safety** — Registry injection skips elements from different application domains.
8. **Element validation gate** — OutputValidator blocks deployment if elements don't resolve.
9. **Exact DOM casing** — Uses DOM property values (not HTML attributes) to preserve correct casing in locators.
10. **Self-healing safety net** — Framework's runtime Self-Healing Engine recovers from minor locator drift, but properties should stay current.

---

## End-to-End Example

### Input: User Story
```markdown
# User Story: Login and Add Product to Cart

## Application URL
https://shop.example.com

## Acceptance Criteria
### AC-1: Login and add product
- Navigate to the application
- Click "Sign In" link
- Enter ##Email into the "Email" field
- Enter ##Password into the "Password" field
- Click the "Login" button
- Click "Products" in navigation
- Click "Add to Cart" on first product
- Verify cart shows "1" item
```

### Step 1: Planner Output (plan.json)
```json
{
  "page": "Shop",
  "url": "https://shop.example.com",
  "elements": [
    { "key": "InputEmail", "locator": "//input[@data-testid='login-email']", "type": "input" },
    { "key": "InputPassword", "locator": "//input[@data-testid='login-password']", "type": "input" },
    { "key": "BtnLogin", "locator": "//button[@data-testid='login-submit']", "type": "button" },
    { "key": "NavProducts", "locator": "role=link[name='Products']", "type": "link" },
    { "key": "BtnAddToCart", "locator": "//button[@data-testid='add-to-cart']", "type": "button" }
  ],
  "testCases": [{ "id": "TC-001", "title": "Login and add product", "steps": [...] }]
}
```

### Step 2: Generator Output

**Shop.properties:**
```properties
# Shop - Input Fields
InputEmail=//input[@data-testid='login-email']
InputPassword=//input[@data-testid='login-password']

# Shop - Buttons
BtnLogin=//button[@data-testid='login-submit']
BtnAddToCart=//button[@data-testid='add-to-cart']

# Shop - Navigation
NavProducts=role=link[name='Products']
```

**shop_from_Story.feature:**
```gherkin
@web @shop_web
Feature: Shop - Login and Cart
  As a user
  I want to interact with the Shop page

  @smoke @e2e
  Scenario: TC-001 Login and add product
    Given I navigate to the application
    When I click 'Shop.NavSignIn'
    When I enter '##Email' into 'Shop.InputEmail'
    When I enter '##Password' into 'Shop.InputPassword'
    When I click 'Shop.BtnLogin'
    When I click 'Shop.NavProducts'
    When I click 'Shop.BtnAddToCart'
    Then 'Shop.CartCount' should have text '1'
```

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `$$password` everywhere | Credential masking caught `##` tokens | Fixed: masking now skips `##`/`$$`/`{` prefixes |
| Wrong element filled (login vs signup) | `.first()` picked first match | Fixed: uses `.last()` + `data-qa*="signup-*"` priority |
| `/signup` page not crawled | Form validation blocked (invalid email entered) | Fixed: generates realistic test data during replay |
| Locator casing wrong (`placeholder=username`) | Used `getAttribute` instead of DOM property | Fixed: uses `.placeholder` property (correct casing) |
| AI skips `store`/`persist` steps | Story ACs not explicit enough | Use exact step syntax in story ACs |
| "Could not find field" during crawl | Hint extractor couldn't parse natural language | Fixed: handles `into the "Name" field` pattern |
