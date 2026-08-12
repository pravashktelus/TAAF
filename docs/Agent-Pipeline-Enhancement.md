# Agent Pipeline Enhancement — Gap Analysis & Solutions

**Date:** August 12, 2026  
**Branch:** `fix/phase-a-agent-gaps`  
**Status:** Implemented & Tested

---

## Executive Summary

The agent pipeline (Planner → Generator → Healer) had 7 identified gaps between what the AGENTS-GUIDE documented and what actually worked. All critical gaps have been resolved across 3 implementation phases. The pipeline now:

- Stops poisoning `.properties` files with invalid TODO locators
- Generates feature files using **existing framework elements** (not invented ones)
- Auto-logs in and navigates to authenticated pages to capture real locators
- Validates output before applying to prevent immediate test failures

---

## Gaps Identified

| # | Gap | Severity | Root Cause |
|---|-----|----------|-----------|
| 1 | TODO locator values written to `.properties` files | **Critical** | `_extractTodoElements()` wrote `# TODO: Add locator...` as locator values |
| 2 | PageCrawler missing `data-qa`/`data-cy` attribute support | **Medium** | Only `data-testid` was checked in `_extractElements()` |
| 3 | AI feature generation unreliable — invents scenarios/elements | **High** | Monolithic 3000+ token prompt; AI ignores plan and invents refs |
| 4 | Planner story mode — AI hallucinates test cases | **Medium** | AI freely generates test cases ignoring explicit acceptance criteria |
| 5 | PageCrawler single-page only — can't reach authenticated pages | **Critical** | No login-then-navigate capability; step-replay too fragile |
| 6 | No output validation before `--apply` | **High** | Invalid features applied directly to `features/web/` causing runtime failures |
| 7 | AGENTS-GUIDE test count claim incorrect | **Low** | Hardcoded "105 passed" drifts as tests are added |

---

## Solutions Implemented

### Phase A — Quick Wins (Immediate Impact)

#### P1: Eliminate TODO Locator Writes
**Problem:** `_extractTodoElements()` wrote strings like `# TODO: Add locator for BtnSearch | Verify at: https://...` as actual locator VALUES in `.properties` files. At runtime, Playwright tried to use these as selectors → crash → self-healing triggered on never-valid locators.

**Solution:**
- Replaced `_extractTodoElements()` with `_detectUnresolvedElements()` — **warns only**, never writes
- Disabled `_buildConventionElements()` — no more fake placeholder elements
- Removed AI instruction to append `# TODO` comments to Gherkin step lines

**Files:** `src/agents/generator/GeneratorAgent.ts`, `src/agents/generator/GeneratePrompts.ts`

---

#### P2: Add `data-qa` and `data-cy` Support
**Problem:** Many applications (automationexercise.com, etc.) use `data-qa` or `data-cy` attributes instead of `data-testid`. The PageCrawler only checked `data-testid`, missing these entirely.

**Solution:** Extended `_extractElements()` locator priority:
```
1. data-testid  →  //element[@data-testid='value']
2. data-qa      →  //element[@data-qa='value']       ← NEW
3. data-cy      →  //element[@data-cy='value']       ← NEW
4. id           →  #element-id
5. placeholder  →  placeholder=text
6. aria-label   →  role=button[name='text']
7. text         →  text=Label
8. css          →  .class-name
```

**Files:** `src/agents/core/PageCrawler.ts`

---

#### P7: Fix Guide Test Count
**Problem:** AGENTS-GUIDE.md claimed "Expected: 105 passed, 0 failed" — hardcoded number that drifts.

**Solution:** Changed to "Expected: All assertions pass with 0 failed"

**Files:** `AGENTS-GUIDE.md`

---

### Phase B — Architecture Improvements

#### P3: Deterministic Feature Generation
**Problem:** The Generator sent a massive prompt to AI asking it to write an entire `.feature` file. GPT-4-turbo consistently:
- Invented page names (`OrdersPage`, `LoginPage`, `SupportPage`)
- Used wrong element refs
- Appended `# TODO` comments to step lines (breaks Cucumber regex)
- Produced fewer/more scenarios than the plan specified

**Solution:** Replaced monolithic AI generation with a **deterministic step mapper**:

```
Plan step → _mapStepToGherkin() → Gherkin step(s)
```

Key components:
- `_findByRole(refs, 'login', 'email')` → finds `TeleConnect.LoginEmail`
- `_findByRole(refs, 'nav', 'orders')` → finds `TeleConnect.NavOrders`
- `_parseCredentials(testData)` → splits `{Email: 'x', Password: 'y'}` into two steps
- `_extractNavTarget(action)` → "My Orders" → strips "My" → matches `NavOrders`

Pattern rules:
| Action Pattern | Generated Step |
|---|---|
| "Enter credentials into login form" | `When I enter '...' into 'TeleConnect.LoginEmail'` + `When I enter '...' into 'TeleConnect.LoginPassword'` |
| "Click Sign In button" | `When I click 'TeleConnect.LoginSubmit'` |
| "Click 'My Orders' navigation link" | `When I click 'TeleConnect.NavOrders'` |
| "Verify order card is visible" | `Then 'Page.OrderCard' should be visible` |

AI is now used **only for refinement** when >50% of steps can't be mapped deterministically, and its output is validated (rejected if it invents more elements than the deterministic version).

**Files:** `src/agents/generator/GeneratePrompts.ts`, `src/agents/generator/GeneratorAgent.ts`

---

#### P4: Deterministic AC Parsing for Planner
**Problem:** In story mode, AI freely generated test cases. Even with explicit acceptance criteria (AC-1 through AC-7), AI produced different scenarios with invented titles and steps.

**Solution:** Added `_parseAcceptanceCriteria()` — regex-based extraction:

Supported formats:
```markdown
### AC-1: Title
- Given I am on the page
- When I click something
- Then I should see result

1. Customer Authentication
2. Dashboard Navigation
```

The parser extracts each AC as a test case with Given/When/Then steps mapped to action/testData/expected. Used in `buildStoryFallback()` when AI is unavailable.

**Files:** `src/agents/planner/PlanPrompts.ts`, `src/agents/planner/PlannerAgent.ts`

---

#### P6: Output Validation Gate
**Problem:** Generated feature files could be applied directly to `features/web/` with `--apply` even when they contained invalid element refs, TODO locators, or malformed steps.

**Solution:** New `OutputValidator.ts` class that validates before writing:

| Check | Blocking for --apply? |
|---|---|
| Scenario count matches plan | Warning only |
| All `'Page.Element'` refs exist in `.properties` | **YES — blocks** |
| No TODO locator values in referenced `.properties` | **YES — blocks** |
| No inline `# TODO` comments on step lines | **YES — blocks** |

Usage in pipeline:
```
Generate feature → Validate → Pass? → Write file
                            → Fail? → Block --apply, show errors
```

**Files:** `src/agents/core/OutputValidator.ts` (new), `src/agents/generator/GeneratorAgent.ts`

---

### Phase C — Multi-Page Navigation

#### P5: Auto-Login for Authenticated Pages
**Problem:** When the Generator crawled `https://app.com/customer/orders`, the app redirected to `/login`. The crawler captured login page elements (7 elements) and stored them as "Orders" page elements — completely wrong. The original step-replay approach was too fragile (fuzzy text matching on element labels).

**Solution:** New `loginAndNavigate(targetUrl)` method in PageCrawler:

```
1. Detect login form on target page (by data-testid='login-email' presence)
2. Read credentials from: env vars → testdata/runtime-store.json → framework.properties
3. Fill email, password, click submit
4. waitForURL() — wait until URL no longer contains '/login'
5. Navigate to original target URL
6. Capture real elements from the authenticated page
```

Detection logic (improved):
```typescript
// OLD: URL comparison (fragile — SPA doesn't change URL on redirect)
const isRedirected = crawledUrl !== url && crawledUrl.includes('login');

// NEW: Content-based detection (works for SPAs)
const isLoginPage = snapshot.elements.some(el =>
  el.locator.includes('login-email') || el.locator.includes('login-password')
);
```

Credential priority chain:
```
1. process.env.TEST_EMAIL / TEST_PASSWORD
2. testdata/runtime-store.json → Email / Password keys
3. framework.properties → test.user.emailDomain + test.user.password
```

**Result:** Generator now creates `OrderHistory.properties` with real locators:
```properties
NavMyOrders=//a[@data-testid='nav-orders']
NavDashboard=//a[@data-testid='nav-dashboard']
BtnNewOrder=//button[@data-testid='btn-new-order']
```

**Files:** `src/agents/core/PageCrawler.ts`, `src/agents/generator/GeneratorAgent.ts`

---

## Before vs After

### Before (all gaps present)
```
npm run agent:generate -- --plan orders-plan.json

Result:
- Orders.properties: BtnSearch=# TODO: Add locator for BtnSearch | Verify at: https://...
- Feature file: AI invents OrdersPage.LoginButton, SupportPage.NavMenu
- Validation: none — --apply writes broken files directly
- Authenticated pages: unreachable — only login page elements captured
```

### After (all fixes applied)
```
npm run agent:generate -- --plan orders-plan.json

Result:
- OrderHistory.properties: NavMyOrders=//a[@data-testid='nav-orders'] (REAL)
- Feature file: uses TeleConnect.LoginEmail, TeleConnect.LoginSubmit, OrderHistory.NavMyOrders
- Validation: ✅ 4 resolved, 2 unresolved (warned, not blocking review copy)
- Authenticated pages: auto-login → navigate → capture real elements
```

---

## Remaining Limitations

| Issue | Workaround | Future Fix |
|---|---|---|
| Order card/detail elements not captured | Page had no orders displayed during crawl | Crawl after test run creates orders |
| Deterministic mapper can't handle highly ambiguous steps | Falls back to `# ACTION:` comment | Improve keyword matching or use focused AI for single steps |
| Credentials must exist in runtime-store.json | Run `npm test` first to register account | Add `--register` flag to PageCrawler |

---

## Test Results

All 106 agent smoke tests pass after all changes:
```
npm run agent:test
Results: 106 passed, 0 failed
```

TypeScript compiles cleanly with zero errors.

---

## Commit History

```
e5102b3 fix: Phase A agent pipeline gaps - stop TODO locator writes, add data-qa support
a374bb5 feat: Phase B - deterministic feature generation, AC parsing, output validation
4f44665 fix: null reference in _buildExpectedAssertions operator precedence
c3c95eb fix: Generator now reuses existing framework elements instead of inventing new ones
0d48d1a fix: rewrite step mapper to properly reuse existing framework elements
5abb53f fix: strip 'My/The' from nav targets - 'My Orders' now matches NavOrders
7d2daef feat: Phase C - multi-page navigation with auto-login for authenticated pages
6a4218b fix: login timing - use waitForURL instead of fixed timeout, log credential source
```

---

*Enhancement implemented on branch `fix/phase-a-agent-gaps` — ready for review and merge.*
