# Release Notes — v1.0

AI-driven BDD test-generation for the Playwright + Cucumber (POM-less) framework.
This document records what the system started as and every enhancement made to reach v1.0.

---

## 1. Where we started (baseline)

The framework began as a **Playwright + TypeScript + Cucumber BDD** automation suite with a
2-layer, page-object-less design:

- **Layer 1 — Feature files** (`features/web/`, `features/api/`) in Gherkin.
- **Layer 2 — Element locators** (`src/pages/properties/<Page>.properties`), referenced in
  features as `'PageName.ElementKey'`.
- **Generic step definitions** (`src/steps/`) handle any app — no page-object classes.
- Supporting engines: Self-Healing, Root-Cause Analysis, Allure + HTML reporting.

On top of this sat an early **3-agent AI pipeline**:

```
User Story (.md) → [Planner] → Plan JSON → [Generator] → .properties + .feature → [npm test] → [Healer] → Report
```

- **Planner** — story → structured test plan (test cases, steps, discovered elements).
- **Generator** — plan → `.feature` + `.properties`, reusing existing locators.
- **Healer** — post-run failure classification.

At the start, the pipeline produced roughly login-only output for complex flows: the crawler
couldn't navigate multi-step SPAs behind auth, negative cases invented error messages/URLs,
and there was no domain awareness. The work below took it to consistent ~90-95% quality on
the happy path with honest, source-grounded negative cases.

---

## 2. Knowledge Bank — structure & selective loading

**What changed**
- Restructured the flat knowledge bank into subfolders: `knowledge/domain/`, `knowledge/patterns/`,
  `knowledge/templates/`.
- `ContextEnricher` now **auto-discovers** all `.md` files recursively — adding a new file or
  folder needs **zero code changes**.
- Added **selective domain loading**: domain-specific knowledge (files under a `domain/<X>/`
  subfolder) loads only when relevant to the current story, driven by a `<!-- triggers: ... -->`
  line in each file. Generic knowledge (top-level `domain/`, `patterns/`, `templates/`) always loads.
- Per-file cap raised to 4500 chars so a focused file (and its tail tables) isn't truncated.

**Why** — keeps prompts lean, prevents cross-domain pollution (telecom knowledge never leaks
into an e-commerce story), and makes the bank extensible without touching code.

---

## 3. Domain knowledge added

- **Telecom domain** (`domain/Telecom domain/`): core lifecycle & roles, test-data/validation
  rules, and distilled **page maps** for the TeleConnect customer wizard and the TeleCRM
  back-office approval flow. Triggers: telecom, broadband, teleconnect, telecrm, etc.
- **E-commerce domain** (`domain/Ecommerce domain/`): generic shopping-journey patterns plus a
  verified **AutomationExercise page map** (register → login → cart). Patterns are locator-free;
  the page map uses real, MCP-captured locators. Triggers: ecommerce, cart, checkout, automationexercise, etc.

The page maps capture the useful part of a DOM snapshot (structure, cascading dependencies,
dynamic-locator rules, "assert visible not exact" for generated values) without the noise.

---

## 4. Element sourcing — the quality lever

Establishing where verified locators come from was the single biggest quality driver.

- **Registry-authoritative rule**: when a curated `.properties` file exists for a page, it is
  the source of truth. The Planner uses ONLY registry elements for that page and **drops
  crawl-discovered noise** (nav/footer/ad links) that otherwise diluted the set and caused the
  AI to bind steps to junk elements.
- **Verified `.properties` capture via Playwright MCP**: full, hand-verified element sets were
  captured for TeleConnect (login → 6-step wizard → success) and AutomationExercise.

**Evidence**: deleting a curated `.properties` dropped happy-path quality from ~95% to ~10%
(force-fit garbage); restoring it recovered it instantly.

---

## 5. Source-repo integration (dev repo → authoritative signals)

Connected the pipeline to the application's **source repository** (Next.js 15 app) for
"inside-out" signals the live DOM can't reliably give.

- **`SourceRepoScanner`** — reads a local clone and extracts:
  - `data-testid` locators for every page (incl. pages behind auth / deep wizard steps),
  - routes (from the App Router folder structure),
  - **validation rules + exact error messages + their error-element testids**,
  - order/status enum values.
- **`SourceIndexProvider`** — façade that reads `agents.appRepo.*` config, scans (or loads a
  cached index), and maps dev routes → framework page names via a configurable `pageMap`.
- **Planner** merges source locators as an authoritative tier (registry wins conflicts; source
  ADDS missing elements, especially the error elements) and feeds **real validation messages**
  into negative-case generation.
- Config keys added to `framework.properties`: `agents.appRepo.enabled/path/url/branch/indexPath/pageMap`.
- The dev repo is cloned into a git-ignored `.devrepo/` folder (read-only; never modified).

**Impact** — negatives now assert real, source-derived truth, e.g.
`'TeleConnect.ErrorCustomerPhone' should have text 'Phone must be exactly 10 digits'`,
replacing earlier hallucinations like "All fields are required" / `/error`.

---

## 6. Test-case generation quality

- **Granular happy path**: the Planner builds the happy-path scenario from the story's
  `## Detailed Steps` section (field-by-field), not the high-level acceptance criteria — so all
  6 wizard steps appear with correct per-field actions and step-badge verifications.
- **Negative-case reachability**: negative scenarios now prepend the real setup prefix
  (register/login → navigate to the target step) so the field under test is actually reachable,
  instead of jumping straight to an inner field.
- **No invented assertions**: when a real validation message is available (from source) the
  negative asserts it on the real error element; otherwise it asserts the flow **did not advance**
  (still on the same step/URL) rather than guessing.
- **Data strategy**: unique fields use random `##` tokens; constrained values (city/state/country/
  DOB/gender/ID type/date) use static realistic literals.

---

## 7. Crawler login — generic & robust

- Fixed the login submit bug: the crawler was "submitting" by clicking the **email input**
  (hint `login` matched `login-email` before `login-submit`), so it never left `/login`.
- `login()` is now generic and type-aware:
  - `_findLoginField()` selects email/password only from input-like elements (bonus for native
    `type=email` / `type=password`),
  - `_findSubmitButton()` selects the submit only from real button-like elements, scored by
    submit signals, explicitly excluding switch/register/social buttons; Enter-key fallback if none.
- Verified: login now clicks the real submit button, reaches `/customer`, and
  `loginAndNavigate('/customer/order')` captures the wizard elements.

---

## 8. Page-name resolution & guardrails

Root-caused a class of failures where a wrong page name silently starved the plan of elements.

- **`derivePage()`** now resolves a KNOWN page before falling back to the story filename, using
  (in order): an explicit `**Page Name:**` story declaration → registry page name in the story →
  a full route-path match from the pageMap. Ambiguous cases fall back safely rather than guess wrong.
- Fixed a **batch-mode bug** where an explicit `--page` was ignored for multi-story runs.
- Added `**Page Name:**` declarations to the TeleConnect and TeleCRM stories for reliable resolution.
- **Generator elements=0 guardrail**: a web plan with no elements, no `.properties`, no source
  coverage, and no crawl source now **aborts with clear guidance** instead of emitting hallucinated,
  force-fit output.

---

## 9. Model determinism

- Pinned `temperature: 0` and `max_tokens: 4096` on the OpenAI call. Test-plan/feature output
  must be precise and reproducible, not creative. This removed redundant/rambling assertions —
  especially important when swapping to a chattier (non-gpt-4-turbo) model.

---

## 10. API generation & misc fixes

- API stories: passthrough for API steps, inline data-table extraction, meaningful expected
  results, status-code-only negative assertions (no invented body error messages).
- Acceptance-criteria parsing handles both `**Bold:**` (single combined scenario) and numbered
  `AC-1/AC-2` (separate scenarios).
- Added an "Analysis & Assumptions" section to generated plans (detected features, assumptions,
  dependencies, warnings) plus story validation for missing URL/ACs/vague steps.
- Assertion-strength guidance (have text vs contain text vs be visible) added to anti-patterns knowledge.

---

## Known limitations (as of v1.0)

- A couple of negative cases still emit `$$email`/`$$password` (unpersisted cross-scenario
  variables) where `##Email`/`##Password` would be correct — a token bug, not structural.
- Occasionally the AI binds a validation-message assertion to the wrong element for a single case.
- Auto page-name resolution is intentionally conservative; genuinely ambiguous same-app,
  multi-page stories should declare `**Page Name:**` or pass `--page`.
- Register-before-login apps still need a seeded account or explicit registration flow; the
  generic crawler handles login but not self-registration yet.
- Scheduled/GitHub-Actions triggering for source-repo sync is not yet built (local scan is done).

---

## Component map (for reference)

| Area | Key files |
|------|-----------|
| Config | `src/config/framework.properties`, `src/agents/config/AgentsConfig.ts` |
| Planner | `src/agents/planner/PlannerAgent.ts`, `PlanPrompts.ts`, `PlanFormatter.ts`, `StoryReader.ts` |
| Generator | `src/agents/generator/GeneratorAgent.ts`, `GeneratePrompts.ts`, `PropertiesWriter.ts`, `FeatureWriter.ts` |
| Core | `LLMClient.ts`, `PlaywrightCrawler.ts`, `PropertiesRegistry.ts`, `ContextEnricher.ts`, `SourceRepoScanner.ts`, `SourceIndexProvider.ts` |
| Knowledge | `src/agents/knowledge/{domain,patterns,templates}/**` |
| Healer | `src/agents/healer/HealerAgent.ts` and helpers |
