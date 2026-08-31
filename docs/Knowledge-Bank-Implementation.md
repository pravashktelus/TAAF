# Knowledge Bank — Implementation Overview

**Purpose:** Explain how the AI Test Automation Agent uses a "Knowledge Bank" to consistently generate high-quality, framework-compliant test scripts.

**Audience:** Engineering Manager / Technical Leadership

---

## 1. What Is the Knowledge Bank?

The Knowledge Bank is a curated set of **reference documents** that teach the AI *how our framework works* before it generates any test. Instead of relying on the AI's generic training, we inject our team's actual conventions, patterns, and rules into every AI request.

**Analogy:** It's the onboarding handbook we'd give a new QA engineer — except it's fed to the AI on every single generation, guaranteeing consistency.

**Why it matters:** Without it, the AI produces generic Gherkin that doesn't match our framework (wrong step patterns, invented steps, inconsistent locators). With it, the AI produces output that follows OUR standards.

---

## 2. The Problem It Solves

| Without Knowledge Bank | With Knowledge Bank |
|------------------------|---------------------|
| AI invents step patterns that don't exist | AI uses only our real step definitions |
| Inconsistent locator strategies | Enforced priority: data-testid → role → CSS |
| Wrong data handling (hardcoded credentials) | Correct `##random` / `$$persisted` usage |
| Generic assertions | Correct assertion strength (exact vs partial) |
| Repeats known mistakes | Anti-patterns explicitly forbidden |

---

## 3. Knowledge Bank Structure

Located at `src/agents/knowledge/` — organized into 3 categories (subfolders), each a focused knowledge type:

```
src/agents/knowledge/
├── domain/                          → "What the app/framework IS"
│   └── domain-knowledge.md          → Framework architecture, data strategy, app patterns
├── patterns/                        → "Rules & correct patterns to FOLLOW"
│   ├── step-definitions-reference.md → Every available step + when to use each
│   ├── anti-patterns.md              → Do's/Don'ts + assertion strength rules
│   ├── locator-patterns.md           → How to write element locator files
│   └── api-patterns.md               → REST API step patterns + examples
└── templates/                       → "Reusable structures to MIMIC"
    ├── feature-examples.md           → Golden reference feature files
    └── test-case-patterns.md         → How to structure test cases per flow type
```

**Auto-discovery:** The agent recursively scans this directory. Adding a new subfolder or `.md` file makes it INSTANTLY available to the AI — **no code change required.**

### What Each File Contains

| File | Teaches the AI |
|------|----------------|
| **domain-knowledge.md** | 2-layer architecture, `##`/`$$`/`{}` data syntax, cross-scenario data flow, common enterprise UI patterns (CRUD, wizards, modals) |
| **step-definitions-reference.md** | The complete catalog of usable Gherkin steps (click, enter, select, assertions, API) with usage guidance |
| **anti-patterns.md** | 10 forbidden mistakes with WRONG→RIGHT examples + assertion strength decision table (when to use `have text` vs `contain text` vs `be visible`) |
| **test-case-patterns.md** | Patterns for registration/login/wizard/CRUD/search flows + dynamic-vs-static data selection rules |
| **feature-examples.md** | Complete, correct example feature files the AI mimics |
| **locator-patterns.md** | Locator priority, naming conventions, `.properties` file format |
| **api-patterns.md** | Exact API step patterns + a golden API feature example + status code guide |

---

## 4. How It's Wired Into the Agent (Technical Flow)

```
┌──────────────────────────────────────────────────────────────┐
│  Knowledge Bank Files (src/agents/knowledge/*.md)             │
└───────────────────────────┬──────────────────────────────────┘
                            │  read at runtime
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  ContextEnricher.ts                                           │
│  • getKnowledgeBankContext()  → loads all 7 files             │
│  • getApiKnowledge()          → loads API patterns only       │
│  • getFullContext(page)       → combines knowledge + existing │
│                                 feature/properties examples   │
└───────────────────────────┬──────────────────────────────────┘
                            │  injected into prompt
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  Planner Agent / Generator Agent                              │
│  • Builds AI prompt = Knowledge Bank + Story + Live DOM       │
│  • Sends to LLM (OpenAI/Anthropic/Ollama)                     │
└───────────────────────────┬──────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  AI generates framework-compliant .feature + .properties      │
└──────────────────────────────────────────────────────────────┘
```

### Code Reference

The single integration point is `ContextEnricher.getKnowledgeBankContext()`, which **auto-discovers** all knowledge files recursively:

```typescript
// src/agents/core/ContextEnricher.ts

// Recursively finds ALL .md files under knowledge/ (any subfolder depth)
private static _findKnowledgeFiles(dir): string[] {
  // walks domain/, patterns/, templates/, and any future subfolder
  // returns sorted list for stable ordering
}

static getKnowledgeBankContext(): string {
  const files = this._findKnowledgeFiles();   // auto-discovered
  // groups by subfolder, adds section headers, truncates for token control
  // returns single combined context block
}
```

This context block is prepended to every AI prompt in both the Planner and Generator agents.

**Key benefit:** Because discovery is recursive and dynamic, adding a new knowledge category (e.g., `security/`, `mobile/`) or a new file requires ZERO code changes — just drop the markdown in.

---

## 5. Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Generic / reusable** | No app-specific hardcoding — works for any enterprise application |
| **Version-controlled** | Plain markdown files in git — reviewable, diffable, PR-approved |
| **Editable by anyone** | QA leads update patterns without touching code |
| **Token-efficient** | Each file truncated to keep AI cost low; API prompts load only API knowledge |
| **Layered** | Full bank for planning; targeted subset for specific generation (e.g., API-only) |
| **Extensible** | Add a new `.md` file + one line in the file list → instantly available to the AI |

---

## 6. How to Extend / Maintain It

**To add new knowledge** (e.g., a new UI pattern, step type, or entire category):
1. Create/edit a markdown file in the appropriate subfolder (`domain/`, `patterns/`, `templates/`) — or create a NEW subfolder
2. Commit via PR — reviewed like any code change

**Zero code changes needed** — the agent auto-discovers all `.md` files recursively. This means QA/BA leads can refine the AI's behavior (or add whole new knowledge categories) without any engineering involvement.

---

## 7. Measurable Impact

| Metric | Before Knowledge Bank | After Knowledge Bank |
|--------|----------------------|----------------------|
| Steps using valid framework patterns | ~50% | ~90%+ |
| Invented/undefined steps | Frequent | Rare |
| Locator consistency | Ad-hoc | Enforced priority |
| Data handling correctness | Manual fixes needed | `##`/`$$` applied automatically |
| Assertion appropriateness | Generic | Context-aware (exact vs partial) |

---

## 8. Roadmap for Further Maturity

- **Few-shot examples in prompt** — embed closest-matching golden example per story type
- **Per-domain knowledge packs** — load auth/e-commerce/API packs based on detected story type
- **Feedback loop** — capture QA edits to generated tests and feed corrections back
- **RAG over existing test suite** — retrieve similar existing tests as live examples

---

## Summary

The Knowledge Bank is a **prompt-engineering layer** that turns a general-purpose LLM into a framework-aware test author. It's implemented as **7 version-controlled markdown files** loaded by `ContextEnricher.ts` and injected into every AI request. It's the primary reason the agent produces consistent, framework-compliant output — and it's maintainable by non-engineers through simple markdown edits.
