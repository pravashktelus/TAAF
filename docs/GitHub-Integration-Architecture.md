# AI Test Automation Agent — GitHub Integration Architecture

**Purpose:** Architecture proposal for integrating the AI BDD Test Generation Agent into the enterprise GitHub development workflow.

**Audience:** Head of Architecture / Engineering Leadership

**Status:** Proposal for review

---

## 1. Executive Summary

We have built an AI-powered agent that converts plain-English user stories into executable, production-ready BDD test automation (Cucumber `.feature` files + element locators). This document proposes how to integrate that agent into our existing GitHub-based development lifecycle so that **test automation is generated automatically whenever a Business Analyst or Developer contributes a requirement**, with a human review gate before merge.

**Goal:** Shift test creation "left" — from a manual, post-development QA activity to an automated, requirement-driven one that runs inside CI/CD.

---

## 2. Current State

| Aspect | Today |
|--------|-------|
| Test creation | Manual — QA engineers write Gherkin + locators by hand after a feature is built |
| Turnaround | Days per feature |
| Coverage | Dependent on QA bandwidth; negative/edge cases often skipped |
| Traceability | Weak link between requirement and test |
| Maintenance | Manual updates when UI changes |

---

## 3. Proposed Future State

| Aspect | With Agent Integration |
|--------|------------------------|
| Test creation | Automated — agent generates tests from user stories on push |
| Turnaround | Minutes per story |
| Coverage | Happy path + AI-generated negative/edge cases by default |
| Traceability | Every test traces to its source story (plan.md documents assumptions) |
| Maintenance | Re-run agent when story/UI changes; self-healing at runtime |

---

## 4. Agent Overview (What It Does)

The agent is a **3-phase pipeline**:

```
User Story (.md) → [PLANNER] → Test Plan (JSON) → [GENERATOR] → .feature + .properties → [HEALER] → Failure Analysis
```

- **Planner** — parses the story, crawls the live application to discover real UI elements, produces a structured test plan with happy-path + negative/edge scenarios
- **Generator** — converts the plan into Cucumber `.feature` files and element locator `.properties` files, validated against the framework's real step definitions
- **Healer** — (post-run) classifies test failures as app-bug vs stale-locator vs self-healed

Key properties:
- **AI-optional** — deterministic fallback if AI is unavailable
- **Multi-provider** — OpenAI / Anthropic / Ollama (local, zero-cost)
- **Knowledge-grounded** — a knowledge bank of framework patterns keeps output consistent
- **Credential-safe** — secrets masked to a runtime store, never committed

---

## 5. Integration Options

### Option A — Same Repository
Tests live alongside application code.
```
dev-repo/
├── src/                     ← application code (developers)
├── requirements/stories/    ← user stories (BAs)
├── features/ + properties/  ← generated tests
└── .github/workflows/       ← agent CI
```
**Pros:** Tests versioned with code; single source of truth
**Cons:** Couples QA tooling with app repo; broader access; noisier PRs

### Option B — Separate Test-Agent Repository (Recommended)
```
dev-repo/  ──(repository_dispatch on app change)──►  test-agent-repo/
                                                     ├── requirements/stories/  (BAs)
                                                     ├── src/agents/            (framework)
                                                     ├── features/ + properties/
                                                     └── .github/workflows/
```
**Pros:** Clean separation; independent access control (BAs write stories, QA reviews tests); doesn't clutter dev repo; independent release cadence
**Cons:** Requires cross-repo signaling for app-change awareness

**Recommendation: Option B** for enterprise scale and governance.

---

## 6. End-to-End Workflow

```
┌────────────────────────────────────────────────────────────────┐
│ 1. BA authors user story → pushes to feature branch            │
│    requirements/stories/NewFeature_Story.md                    │
└───────────────────────────┬────────────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────────────┐
│ 2. GitHub Action triggers (push to stories/ OR PR opened)      │
│    • Detects changed story files via git diff                  │
│    • Provisions Node + Playwright browsers                     │
│    • Injects secrets (AI key, app test credentials)            │
│    • Validates story format (fails fast if too ambiguous)      │
└───────────────────────────┬────────────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────────────┐
│ 3. Planner Agent runs on changed stories                       │
│    • Crawls live app → discovers real locators                 │
│    • Produces plan.json + plan.md (Analysis & Assumptions)     │
└───────────────────────────┬────────────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────────────┐
│ 4. Generator Agent runs                                        │
│    • Generates .feature + .properties                          │
│    • Validates every step against real step definitions        │
│    • Masks credentials → runtime store                         │
└───────────────────────────┬────────────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────────────┐
│ 5. (Optional) Execute generated tests against staging          │
│    • Produces Cucumber/Allure report                           │
└───────────────────────────┬────────────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────────────┐
│ 6. Auto-open Pull Request                                      │
│    • Commits generated .feature/.properties                    │
│    • plan.md (assumptions + warnings) as PR description        │
│    • Test report posted as PR comment                          │
│    → QA reviews and merges (human-in-the-loop gate)            │
└────────────────────────────────────────────────────────────────┘
```

---

## 7. Trigger Strategy

| Trigger | Fires When | Recommended Use |
|---------|-----------|-----------------|
| `push` to `requirements/stories/**` | BA commits a story | Primary — auto-generate on story change |
| `pull_request` | PR opened/updated | Generate + review before merge |
| `workflow_dispatch` | Manual button | On-demand / re-generation |
| `repository_dispatch` | Signal from dev-repo | App changed → notify QA to regenerate |

**Change detection** ensures only NEW/CHANGED stories are processed — not the whole suite every run — controlling cost and runtime.

---

## 8. Infrastructure & Runner Strategy

| Requirement | Solution |
|-------------|----------|
| Browser for crawling | Playwright Chromium (auto-installed on runner) |
| Public application | GitHub-hosted runners |
| **Internal / VPN-only application** | **Self-hosted runner inside corporate network** |
| AI model access | OpenAI/Anthropic API (secret) or self-hosted Ollama (no external calls — data stays internal) |

> For internal applications and data-sensitivity, a **self-hosted runner + Ollama (local LLM)** keeps all crawling and AI inference inside the corporate boundary — no code, credentials, or DOM leaves the network.

---

## 9. Security & Governance

| Concern | Control |
|---------|---------|
| AI API keys | GitHub encrypted secrets; never in code |
| App test credentials | GitHub secrets → env vars; masked in generated output |
| Discovered secrets | Credential-masking engine replaces values with `$$` references |
| Data residency | Option for on-prem Ollama — zero external AI calls |
| Human oversight | Auto-PR (not auto-merge) — QA reviews every generated test |
| Story quality gate | Built-in validation fails the pipeline if a story is too vague |
| Audit trail | Every test traces to a story; plan.md records assumptions |

---

## 10. Cost Model

| Item | Estimate |
|------|----------|
| Per story (Planner + Generator, GPT-4-turbo) | ~$0.05–$2.00 depending on flow complexity |
| Per story (gpt-4o-mini) | ~10x cheaper |
| Per story (self-hosted Ollama) | $0 (compute only) |
| Optimization | Process only changed stories; prompt caching; local LLM option |

Token usage is tracked and reported per run for cost visibility.

---

## 11. Human-in-the-Loop Model (Recommended)

```
Agent generates → Opens PR → QA reviews plan.md + .feature → Approves/edits → Merges
```

We deliberately **do NOT auto-merge**. The agent accelerates creation; humans retain approval authority. The `plan.md` "Analysis & Assumptions" section makes review fast by surfacing what the agent detected, assumed, and flagged.

---

## 12. Rollout Plan (Phased)

| Phase | Scope | Outcome |
|-------|-------|---------|
| **Phase 1 — Pilot** | 1 team, 1 app, manual `workflow_dispatch` trigger | Prove generation quality on real stories |
| **Phase 2 — Auto-trigger** | Same team, `push`-triggered + auto-PR | Validate CI integration + review workflow |
| **Phase 3 — Self-hosted runner** | Internal apps behind VPN | Extend to non-public applications |
| **Phase 4 — Org rollout** | Multiple teams, `repository_dispatch` from dev repos | Full E2E, shift-left across org |
| **Phase 5 — Local LLM** | Data-sensitive apps | On-prem Ollama, zero external AI |

---

## 13. Success Metrics

- **Time-to-test:** story merged → tests available (target: minutes vs days)
- **Coverage:** % of stories with auto-generated negative/edge cases
- **Review effort:** avg QA edits per generated feature (should trend down)
- **Traceability:** % of tests linked to a source story (target: 100%)
- **Cost per story:** AI token spend tracked per run

---

## 14. Open Questions for Discussion

1. **Same-repo vs separate test-agent repo** — governance preference?
2. **AI provider** — cloud (OpenAI/Anthropic) vs on-prem (Ollama) for data residency?
3. **Runner strategy** — are target apps public or VPN-internal (self-hosted runner needed)?
4. **Merge policy** — confirm human-in-the-loop (auto-PR) vs any appetite for auto-merge on high-confidence output?
5. **Scope of Phase 1 pilot** — which team/application?
6. **Staging environment** — is there a stable staging URL the agent can crawl + run tests against?

---

## 15. Appendix — What Already Exists

- ✅ Planner, Generator, Healer agents (working, tested across 8+ applications)
- ✅ Live DOM crawler with element discovery + AI-driven navigation
- ✅ Knowledge bank (framework patterns, step definitions, locator strategy, API patterns)
- ✅ Story validation + Analysis & Assumptions reporting
- ✅ Credential masking + cross-scenario data persistence
- ✅ Multi-provider AI + deterministic fallback
- ✅ Token usage tracking for cost control
- ⬜ GitHub Actions workflow (to be built — this proposal)
- ⬜ Change-detection CI wrapper (to be built)
- ⬜ Auto-PR automation (to be built)
