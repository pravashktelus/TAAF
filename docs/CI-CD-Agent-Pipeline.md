# CI/CD — AI BDD Agent Pipeline (GitHub Actions)

Automates the agent flow with **three human-in-the-loop approval gates**, triggered when
a requirement changes on a feature branch.

## Flow

```
push to <feature-branch> touching requirements/**
   │
   ▼
[Job 1] PLAN ─ Planner runs on the changed story → uploads plan .md/.json
   │
   ▼  ⏸ GATE 1  (environment: plan-review — human reviews the plan .md, clicks Approve)
[Job 2] GENERATE ─ Generator (no --apply) → uploads .feature + .properties
   │
   ▼  ⏸ GATE 2  (environment: feature-review — human reviews the feature, clicks Approve)
[Job 3] EXECUTE ─ apply feature to features/web/, run tests → uploads HTML report
   │
   ▼  ⏸ GATE 3  (environment: execution-review — human reviews the report, clicks Approve)
[Job 4] MERGE ─ merges the feature branch into main
```

Each gate is a job bound to a **GitHub Environment with required reviewers**. When the job
starts it enters a "Waiting" state until an approver clicks **Review deployments → Approve**
on the Actions run page. That is how the pipeline "pauses" for human review.

## One-time setup

### 1. Create three protected environments
Repo → **Settings → Environments → New environment**. Create each of these and add
**Required reviewers** (the people who approve):

| Environment        | Gate meaning                          |
|--------------------|---------------------------------------|
| `plan-review`      | Approve the generated test **plan**   |
| `feature-review`   | Approve the generated **feature**     |
| `execution-review` | Approve the **test report** → merge   |

Without required reviewers on these environments, the jobs will NOT pause — they'd run
straight through. Adding reviewers is what creates the human gate.

### 2. Add secrets
Repo → **Settings → Secrets and variables → Actions → Secrets**:

| Secret           | Purpose                                                                 |
|------------------|-------------------------------------------------------------------------|
| `OPENAI_API_KEY` | AI model access for Planner/Generator (matches your local key).         |
| `DEVREPO_TOKEN`  | A PAT / fine-grained token with **read** access to the dev app repo (`AshishVats-Telus/TeleCom_Application`) so the runner can clone it for source-repo scanning. |

### 3. Add variables
Repo → **Settings → Secrets and variables → Actions → Variables**:

| Variable  | Value (example)                                                            |
|-----------|----------------------------------------------------------------------------|
| `APP_URL` | `https://telecom-app-171032253690.northamerica-northeast1.run.app/login`  |

### 4. Branch protection (recommended)
Protect `main` so the pipeline's merge is the controlled path. The final job pushes to
`main` using the built-in `GITHUB_TOKEN` (the workflow requests `contents: write`).

## How reviewers approve
1. Open the running workflow under the repo's **Actions** tab.
2. When a gated job shows **Waiting**, click **Review deployments**.
3. Read the artifact for that stage (see below), then **Approve and deploy** (or Reject).

## Artifacts to review at each gate
| Gate               | Download artifact   | What to check                                  |
|--------------------|---------------------|------------------------------------------------|
| `plan-review`      | `plan`              | `generated/plans/*.md` — coverage of test cases |
| `feature-review`   | `generated-feature` | `generated/features/*.feature` + `.properties`  |
| `execution-review` | `test-report`       | `reports/html/` — pass/fail results             |

The plan/feature file paths are also printed as **`::notice`** annotations on each job
(visible in the run summary), so reviewers get the exact path without digging.

## Notes & assumptions
- **Trigger scope**: only `requirements/**` changes on **non-main** branches.
- **Branch model**: work happens on a feature branch; the final gate merges it to `main`.
- **Test execution** does not fail the job on test failures (`npm test || true`) — the
  human reviews the report and decides at gate 3. Tighten this later if you want red
  builds to auto-block.
- **App reachability**: `APP_URL` must be reachable from GitHub-hosted runners. The
  TeleCom Cloud Run URL is public, so this works; for a private app you'd need a
  self-hosted runner or tunnel.
- **Dynamic plan/feature names**: the workflow globs the newest file in
  `generated/plans` / `generated/features` rather than hard-coding names.
