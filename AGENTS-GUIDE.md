# Playwright BDD Framework — AI Agents Guide

This framework includes three AI-powered agents that mirror Playwright's official test agent model (Planner → Generator → Healer). They work as standalone CLI tools — no IDE required.

---

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    BDD Framework — Two Modes                    │
├─────────────────────────────────────────────────────────────────┤
│  MODE 1: EXECUTE (existing BDD tests)                           │
│  npm test  →  Cucumber + Playwright + Self-Healing              │
│                                                                 │
│  MODE 2: ASSIST (AI Agents — new)                               │
│  npm run agent:plan     →  Generate test plan from story        │
│  npm run agent:generate →  Generate .feature + .properties      │
│  npm run agent:heal     →  Analyse failures after test run      │
└─────────────────────────────────────────────────────────────────┘
```

The agents are **completely isolated** from test execution. Running `npm test` has zero awareness of agent code.

---

## Prerequisites

### AI Configuration (optional but recommended)

Set your AI provider key in `features/.env`:

```env
OPENAI_API_KEY=sk-your-key-here
```

Configure provider in `src/config/framework.properties`:

```properties
agents.enabled=true
agents.ai.provider=openai       # openai | anthropic | ollama
agents.ai.model=gpt-4-turbo     # model name
agents.output.dir=generated     # output folder
```

> **No AI key?** All agents still work — they use fallback templates and rule-based logic. AI enhances quality but is never required.

### AI Provider Options

| Provider | Key Required | Cost | Setup |
|---|---|---|---|
| `openai` | `OPENAI_API_KEY` | Paid | Default |
| `anthropic` | `ANTHROPIC_API_KEY` | Paid | `npm install @anthropic-ai/sdk` |
| `ollama` | None | Free | Run Ollama locally |

---

## Input Folders

```
requirements/
├── stories/           ← Drop BA user stories here (.md, .txt, .docx)
│   ├── README.md
│   └── attachments/   ← Supporting docs for stories
│       └── {story-name}/
│           ├── mockup.png
│           └── business-rules.docx
└── testcases/         ← Drop manual test cases here (.xlsx, .md)
    └── README.md
```

---

## Output Folders

```
generated/
├── plans/             ← Planner output (test plans)
│   ├── {Page}-plan_from_{source}.md    ← human-readable (QA reviews)
│   └── {Page}-plan_from_{source}.json  ← Generator input
├── features/          ← Generator output (review copies)
│   └── {page}_from_{source}.feature    ← review before applying
└── reports/           ← Healer output
    ├── healing-report.md               ← human-readable
    └── healing-report.json             ← structured data
```

> Review copies in `generated/` are **never committed** (git-ignored). Apply them manually or use `--apply` flag.

---

## Agent 1: Planner

**Purpose:** Reads a user story or test cases → generates a structured test plan.

### Commands

```bash
# From story file (AI generates test cases)
npm run agent:plan -- --story orders-creation.md --page Orders

# From test cases XLS (parses existing cases)
npm run agent:plan -- --testcases orders-testcases.xlsx --page Orders

# With live page crawl (discovers real elements)
npm run agent:plan -- --story orders.md --url https://app.com/orders --page Orders

# Auto-login before crawling (authenticated pages)
npm run agent:plan -- --story orders.md --url https://app.com/orders --page Orders --login

# Auto-derive page name from file (--page optional)
npm run agent:plan -- --story CustomerSupport_Story1.md
```

### CLI Options

| Option | Description | Required |
|---|---|---|
| `--story <file>` | Story file from `requirements/stories/` | One of these |
| `--testcases <file>` | Test cases file from `requirements/testcases/` | One of these |
| `--url <url>` | URL to crawl for element discovery | Optional |
| `--page <name>` | Page name (auto-derived if omitted) | Optional |
| `--mode story\|testcases` | Force input mode (overrides auto-detection) | Optional |
| `--login` | Auto-login before crawling authenticated pages | Optional |
| `--attachments <path>` | Custom attachments folder path | Optional |

### Input Mode Detection

The Planner automatically detects whether input is a story or test cases:

| Signal | Mode |
|---|---|
| File in `requirements/stories/` | story — AI generates test cases |
| File in `requirements/testcases/` | testcases — parse and reformat |
| Content has "As a...", "Acceptance Criteria" | story |
| Content has "TC-001", "Step No", "Expected Result" | testcases |
| XLS with TC ID column | testcases |

### Supported File Formats

| Format | story folder | testcases folder |
|---|---|---|
| `.md` | ✅ | ✅ |
| `.txt` | ✅ | ✅ |
| `.docx` | ✅ | ✅ |
| `.pdf` | ✅ | ❌ |
| `.xlsx` / `.xls` | ❌ | ✅ |
| Images `.png` `.jpg` | ✅ (attachments) | ❌ |

### XLS Column Mapping

If your Excel uses different column headers, update `src/config/framework.properties`:

```properties
agents.xls.col.tcId=TC ID
agents.xls.col.title=Title
agents.xls.col.stepNo=Step No
agents.xls.col.action=Action
agents.xls.col.navigation=Navigation
agents.xls.col.testData=Test Data
agents.xls.col.expected=Expected Result
agents.xls.groupByTcId=true
```

Multi-row test cases (same TC ID across rows) are automatically grouped.

### Output

```
generated/plans/Orders-plan_from_orders-creation.md    ← QA reviews this
generated/plans/Orders-plan_from_orders-creation.json  ← Feed to Generator
```

---

## Agent 2: Generator

**Purpose:** Reads a plan JSON → generates `.feature` file and `.properties` file.

### Commands

```bash
# Minimal (no URL — uses registry + existing patterns)
npm run agent:generate -- --plan "generated/plans/Orders-plan_from_orders-creation.json"

# With single URL (crawls page for real locators)
npm run agent:generate -- --plan "generated/plans/Orders-plan_from_orders-creation.json" --url https://app.com/orders

# With multiple URLs (multi-page flow)
npm run agent:generate -- --plan "generated/plans/Support-plan_from_Story1.json" --urls "https://app.com/login,https://app.com/orders,https://app.com/support"

# Auto-login before crawling
npm run agent:generate -- --plan "generated/plans/Support-plan_from_Story1.json" --target-url https://app.com/support --login

# Apply feature file directly to features/web/ (skip review copy)
npm run agent:generate -- --plan "generated/plans/Orders-plan_from_orders-creation.json" --apply
```

### CLI Options

| Option | Description | Required |
|---|---|---|
| `--plan <path>` | Path to plan JSON from Planner | Yes |
| `--url <url>` | Single URL to crawl | Optional |
| `--urls <urls>` | Comma-separated URLs for multi-page flow | Optional |
| `--target-url <url>` | Navigate to this URL after login | Optional |
| `--login` | Auto-login before crawling | Optional |
| `--apply` | Write directly to `features/web/` | Optional |

### URL Resolution Priority

```
1. --url / --urls / --target-url flags (explicit)
2. plan.url from plan JSON (auto)
3. URLs extracted from plan test case steps (auto)
4. Registry + fuzzy match (no URL at all)
```

### Element Resolution

For each element the Generator discovers:

```
Page name + locator matches existing .properties file
→ REUSE existing ref (e.g. CustomerSupport.BtnSignIn)

Page name or locator doesn't match
→ NEW element → add to {Page}.properties

Authenticated page, no login
→ Redirect detected → warn user → skip crawl
→ Fall back to registry matching
```

### Output

```
src/pages/properties/{Page}.properties   ← new elements written here
generated/features/{page}_from_{source}.feature  ← review copy
```

After reviewing the feature file, apply it:
```bash
# Move to features/web/ manually
# OR re-run with --apply flag
npm run agent:generate -- --plan "..." --apply
```

---

## Agent 3: Healer

**Purpose:** Reads test run reports → classifies failures → tells QA exactly what to fix.

### Commands

```bash
# Analyse last test run (default report path)
npm run agent:heal

# Analyse specific report
npm run agent:heal -- --report reports/cucumber-json/cucumber-report.json

# Enable AI for ambiguous cases
npm run agent:heal -- --ai
```

### CLI Options

| Option | Description | Required |
|---|---|---|
| `--report <path>` | Path to cucumber-report.json | Optional (uses default) |
| `--ai` | Use AI for ambiguous failure classification | Optional |

### Classification Rules

| Failure Signal | Classification | What QA Should Do |
|---|---|---|
| `toHaveText` failed, element found | 🐛 **APP FAULT** | Raise a defect |
| Expected X received Y (assertion) | 🐛 **APP FAULT** | Raise a defect |
| API status code wrong | 🐛 **APP FAULT** | Raise a defect |
| Locator timeout / element not found | 🔧 **TEST FAULT** | Update locator in `.properties` |
| `healed_*.png` screenshot exists | ✨ **SELF-HEALED** | Persist healed locator to `.properties` |
| URL / navigation mismatch | 👁️ **REVIEW** | Investigate manually |

### Output

```
generated/reports/healing-report.md    ← open this (human-readable)
generated/reports/healing-report.json  ← structured data
```

### Sample Report

```markdown
# Healing Report
Run: 2026-07-11 | Total: 8 | Passed: 5 | Failed: 3

## Quick Summary
- 🐛 1 App Bug — raise defect
- 🔧 1 Test Issue — update locator
- ✨ 1 Self-Healed — persist fix

## Action Required

### 🐛 Verify ticket status
Classification: APP BUG
Reason: Expected 'OPEN' but element returned ''
Action: Raise a defect — application not showing ticket status
Failed Step: `'CustomerSupport.TicketStatus' should have text 'OPEN'`

### 🔧 Click support button
Classification: TEST ISSUE
Reason: Locator timeout — element not found
Action: Update CustomerSupport.properties → verify BtnSupport locator in DevTools
Properties File: `src/pages/properties/CustomerSupport.properties`

### ✨ Place new order
Classification: SELF-HEALED (persist fix)
Reason: TeleConnect.BtnNewConnection was self-healed at runtime
Action: Open screenshot → get new locator → update TeleConnect.properties
```

---

## Complete Workflow

### Workflow A: Story-based (new feature)

```bash
# 1. Drop story in requirements/stories/
cp your-story.md requirements/stories/

# 2. Plan — AI generates test cases
npm run agent:plan -- --story your-story.md

# 3. Review plan
open generated/plans/YourStory-plan_from_your-story.md

# 4. Generate feature + properties
npm run agent:generate -- --plan "generated/plans/YourStory-plan_from_your-story.json"

# 5. Review generated files
open generated/features/yourstory_from_your-story.feature
open src/pages/properties/YourStory.properties   # verify TODO locators

# 6. Apply feature file
npm run agent:generate -- --plan "generated/plans/YourStory-plan_from_your-story.json" --apply

# 7. Run tests
npm test

# 8. Analyse results
npm run agent:heal
open generated/reports/healing-report.md
```

### Workflow B: Test Cases-based (existing QA test cases)

```bash
# 1. Drop test cases in requirements/testcases/
cp your-testcases.xlsx requirements/testcases/

# 2. Plan — parses existing test cases
npm run agent:plan -- --testcases your-testcases.xlsx

# 3. Generate (same as above from step 4)
npm run agent:generate -- --plan "generated/plans/..."
```

### Workflow C: After test run (maintenance)

```bash
# After npm test completes
npm run agent:heal

# Open report and follow actions
open generated/reports/healing-report.md
```

---

## Kiro / AI IDE Usage

If you're using Kiro, Claude Code, Cursor, or any MCP-compatible AI tool, the `.agents/` folder provides agent definitions:

```
.agents/
├── planner.md    ← Planner agent definition
├── generator.md  ← Generator agent definition
└── healer.md     ← Healer agent definition
```

**In Kiro chat:**
```
"Plan test scenarios for the Orders page"
"Generate feature file from generated/plans/Orders-plan.json"
"Analyse the last test run failures"
```

The AI IDE uses Playwright MCP tools interactively — same output as CLI but conversational.

---

## Running Smoke Tests

Verify the agent module is working correctly:

```bash
npm run agent:test
```

Expected: `105 passed, 0 failed`

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `Plan has no test cases` | Re-run `agent:plan` with a valid story file |
| `Elements all TODO markers` | Provide `--url` so Generator can crawl real locators |
| `Wrong elements (login page)` | Page requires auth — redirect detected, add `--login` flag |
| `Support.ElementKey everywhere` | Page name mismatch — use exact `.properties` file name as `--page` |
| `Report not found` | Run `npm test` first to generate reports |
| `AI unavailable` | Check `OPENAI_API_KEY` in `features/.env` — fallback templates used if missing |
| `agents.enabled=false` | Set `agents.enabled=true` in `framework.properties` |

---

## File Structure

```
src/agents/
├── config/
│   └── AgentsConfig.ts          ← reads agent config from framework.properties
├── core/
│   ├── LLMClient.ts             ← multi-provider AI client (OpenAI/Anthropic/Ollama)
│   ├── PageCrawler.ts           ← Playwright DOM explorer
│   ├── PropertiesRegistry.ts    ← scans existing .properties files
│   └── ContextEnricher.ts       ← feeds existing feature/properties as AI context
├── planner/
│   ├── PlannerAgent.ts          ← CLI: npm run agent:plan
│   ├── StoryReader.ts           ← reads MD/DOCX/PDF/XLS + attachments
│   ├── PlanPrompts.ts           ← builds AI prompts for planner
│   └── PlanFormatter.ts         ← writes plan .md and .json
├── generator/
│   ├── GeneratorAgent.ts        ← CLI: npm run agent:generate
│   ├── GeneratePrompts.ts       ← builds AI prompts for generator
│   ├── PropertiesWriter.ts      ← writes/appends .properties files
│   └── FeatureWriter.ts         ← writes .feature files
├── healer/
│   ├── HealerAgent.ts           ← CLI: npm run agent:heal
│   ├── ReportReader.ts          ← reads cucumber-report.json + healed screenshots
│   ├── FailureClassifier.ts     ← classifies failures (rule-based + AI)
│   └── HealingReportWriter.ts   ← writes healing-report.md + .json
└── tests/
    └── phase1.test.ts           ← smoke tests: npm run agent:test

.agents/
├── planner.md                   ← Playwright-standard definition (for AI IDEs)
├── generator.md
└── healer.md

requirements/
├── stories/                     ← drop BA stories here
└── testcases/                   ← drop QA test cases here

generated/                       ← agent output (git-ignored)
├── plans/
├── features/
└── reports/
```

---

*Framework version: 1.0 | Agent Module: Phase 1-4 complete*
