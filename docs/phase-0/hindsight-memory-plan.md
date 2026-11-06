# FlakeTrail Memory System Plan

**Core memory system:** Hindsight (https://hindsight.vectorize.io/)
**Purpose:** Remember previous CI debugging investigations so developers can reuse historical knowledge when similar failures happen again.

This document is a plan only. It contains no application code. It describes what to store, how to store it, how to retrieve it, and how to reason over it using Hindsight's three operations: **RETAIN**, **RECALL**, **REFLECT**.

All SDK call snippets and JSON records in this document are **conceptual examples only**. Actual implementation must follow the current Hindsight TypeScript SDK/API (https://hindsight.vectorize.io/sdks/nodejs).

---

## How the three Hindsight operations map to FlakeTrail

| Hindsight operation | FlakeTrail meaning | What it does in this plan |
|---|---|---|
| **RETAIN** (`retain()`) | Save an investigation | Extracts the failure, each hypothesis, each attempted fix, and the confirmed outcome into typed facts (world vs experience), links entities, tags them with status, and stores them in an isolated memory bank. |
| **RECALL** (`recall()`) | Find similar failures | Runs four searches in parallel (semantic, keyword, graph, temporal), fuses them, re-ranks, and returns the most relevant past investigations within a token budget. |
| **REFLECT** (`reflect()`) | Reason over history | Runs an agentic loop over the returned facts, applies disposition and directives, and returns a recommendation with citations (`based_on`). |

---

## 1. What information should FlakeTrail remember?

FlakeTrail remembers **investigations**, not general chat. Each investigation is one CI failure and everything done to resolve it.

### Information to remember (per investigation)

| Category | Example | Why it matters |
|---|---|---|
| Failure identity | CI job name, pipeline ID, commit SHA, branch, test name (`test_payment_retry`), exit code | Lets Recall match the same test/pipeline across failures. |
| Error signature | Error message, stack trace head, flaky vs deterministic flag | Semantic and keyword search match on the error itself. |
| Environment | OS, language/runtime version, test framework, CI provider, region | Tags for filtering; similar stack = similar fix. |
| Hypotheses formed | "The timeout is too low", "The mock gateway keeps shared state" | Captures reasoning so failed hypotheses are not repeated. |
| Attempts | What was changed, which files, who proposed it, the confirmed result (failed / passed_unmerged / verified) | Negative evidence (failed attempts) and positive evidence (fixes). |
| Outcome | CI green after merge, time to resolve, PR link, investigator | Only a post-merge green CI counts as confirmed. |
| Artifacts | Links to CI logs, test reports, screenshots of the failure | Evidence that can be re-read later via chunks. |

### What FlakeTrail does NOT remember (scope boundary)

- General project documentation unrelated to a failure.
- Non-CI debugging (local dev issues that never hit CI).
- Personal developer preferences or chat unrelated to the failure.
- Code style or architecture advice unrelated to a specific failing test.

### Security rule: redact secrets before storing

Before any CI log, error output, or artifact is retained, **secrets and credentials must be redacted** (API keys, tokens, passwords, connection strings, private keys). Redaction happens **before storage**, so secrets never enter the memory bank.

> Memory is not automatically accurate. A stored hypothesis, stack trace, or "root cause" can be wrong. FlakeTrail treats everything as evidence to be checked, never as truth.

---

## 2. How should a new failure investigation be saved? (RETAIN)

### The saving process aligned to the user journey

1. **CI failure detected.** A CI job fails. The failure output (logs, error message) is captured.
2. **Redact secrets.** Secrets and credentials are redacted from CI logs and artifacts **before anything is stored**.
3. **Retain raw evidence (not a completed memory yet).** The redacted failure context is retained as raw evidence. An uploaded log is raw evidence — it is **not** a "completed memory" and not a confirmed outcome.
4. **Hypotheses are proposed, not confirmed.** As the investigation proceeds, the agent or developer forms hypotheses (e.g., "the timeout is too low"). Each hypothesis is recorded with status `proposed`. A proposed suggestion is **not** a completed memory and **not** a fix.
5. **Attempts are executed and results come back.** Each proposed fix is tried in CI. When the result is known:
   - CI still fails → save the attempt with status `failed`.
   - CI passes but the change is not merged → save with status `passed_unmerged`.
   - CI passes and the change is merged → save with status `verified`.
6. **Only confirmed outcomes are completed memories.** A memory is "completed" only when it carries a confirmed outcome (`failed`, `passed_unmerged`, or `verified`). Unverified proposals remain `proposed` and are not promoted to confirmed.

### Statuses (MVP)

| Status | Meaning | Counts as confirmed fix? |
|---|---|---|
| `proposed` | Suggested by AI or developer, not yet tried | No |
| `failed` | Tried in CI; CI still failed | No |
| `passed_unmerged` | CI passed, but change not merged | No |
| `verified` | CI passed and change merged | **Yes** |

### World facts vs experience facts (important distinction)

Hindsight classifies every fact by **who is speaking**. FlakeTrail must set the `context` so the split is correct:

| Speaker | Statement | Stored as | Example |
|---|---|---|---|
| CI system / test runner | "test_payment_retry timed out after 30s" | **world** fact (fact about the failure) | The failure itself. |
| FlakeTrail agent | "I increased the timeout to 60s and re-ran" | **experience** fact (the agent's own action) | What FlakeTrail did. |
| Developer | "I think the mock shares state" | **world** fact about the developer | A hypothesis attributed to its speaker. |

Setting the context (e.g. `"The FlakeTrail agent is speaking"` vs `"CI output is speaking"`) prevents the agent from mis-attributing a CI error as its own action, or a developer's guess as an agent fact.

### How it is retained (conceptual)

```text
Conceptual example only — follow the current Hindsight TypeScript SDK/API.

retain(bank="flake-trail", content=[
  "CI job build-4021 on pipeline main#189 failed: test_payment_retry",
  "Error: timeout after 30s waiting for payment gateway mock",  // secrets redacted before storage
  "Files: payments/service_test.py, payments/mock_gateway.py",
  "Hypothesis 1: the timeout is too low (proposed by AI, unverified)",
  "Attempt 1: increased timeout to 60s — result: still flaky",
  "Hypothesis 2: the mock gateway keeps shared state between tests",
  "Attempt 2: reset mock state between tests — result: CI green, PR #3342 merged",
], tags=["ci:github-actions", "lang:python", "framework:pytest", "area:payments"], context="The FlakeTrail agent is speaking")
```

Key choices:

- **Only attempts with a known result are saved** as `failed`, `passed_unmerged`, or `verified`. A bare `proposed` suggestion is not a completed memory.
- **Tags** (`ci:`, `lang:`, `framework:`, `area:`) let Recall filter later so only relevant investigations come back.
- **Retain mission** steers extraction toward technical decisions: *"Capture CI failures, hypotheses, attempted fixes, file changes, and verification outcomes. Ignore greetings and meeting logistics."*
- **Security:** secrets/credentials are redacted from CI logs before storage.
- **Temporal grounding:** Hindsight records both *when the failure occurred* and *when it was learned*, so "what failed last month?" works and recent failures rank higher.

---

## 3. How should FlakeTrail find similar previous failures? (RECALL)

### The recall flow (MVP)

When a new CI failure appears:

1. Build a recall query from the failure signature: test name, error message, CI provider, language/framework.
2. Call `recall(bank="flake-trail", query=...)` with tags matching the same stack (language/CI provider/test area).
3. Hindsight runs four searches **in parallel** — semantic, keyword (BM25), graph, temporal — fuses them by consensus, re-ranks, and returns the most relevant past investigations within a token budget.
4. Recall returns memories (including their status tags), not answers. It does not decide which fix is correct.

### Conceptual example only

```text
recall(bank="flake-trail", query="test_refund_retry timeout waiting for payment gateway mock", tags=["lang:python","ci:github-actions","area:payments"])
```

Actual implementation must follow the current Hindsight TypeScript SDK/API.

### Future enhancements (out of MVP scope)

Advanced retrieval tuning (budget levels, `max_tokens` tuning, `include_chunks`, cross-encoder configuration) and proof-count-based ranking are deferred. The MVP uses default recall settings with tag filtering.

---

## 4. How should it use previous failed attempts?

Failed attempts are **negative evidence**, and they are valuable:

- **Don't repeat them.** If "increase the timeout to 60s" was tried and failed, FlakeTrail should not suggest it again for a similar timeout failure.
- **Narrow the root cause.** A failed attempt rules out one hypothesis, making the remaining ones more likely.
- **Present as evidence, not as a candidate fix.** A failed attempt is presented as *"this was tried and did not fix it"*, not as a candidate fix.

---

## 5. How should it remember successful solutions?

A solution becomes a **confirmed fix** only after verification:

1. A fix is attempted.
2. CI is re-run on the fixed branch.
3. CI passes **and** the change is merged.
4. Only then is the attempt stored with status `verified`.

**Only `verified` records can be labelled confirmed fixes.** `passed_unmerged` (CI passed but not merged) is **not** a confirmed fix.

### Future enhancements (out of MVP scope)

Knowledge pages, mental models, and proof-count optimization are deferred. The MVP relies on RETAIN, RECALL, and REFLECT over raw facts and status-tagged attempts.

---

## 6. How should it distinguish confirmed solutions from unverified suggestions?

### Rule

**Only `verified` records (CI green + merged) can be labelled confirmed fixes.** An AI suggestion, even if it sounds plausible, is never a confirmed solution.

### Enforcement by FlakeTrail's backend

This rule must be enforced by **FlakeTrail's backend**, not only by Hindsight directives:

- The backend assigns and guards the statuses (`proposed`, `failed`, `passed_unmerged`, `verified`).
- The backend only promotes an attempt to `verified` after confirming CI passed **and** the change merged.
- The backend never exposes a `proposed` or `passed_unmerged` record as a confirmed fix to the developer.

### How Hindsight supports this

- **Status tags on every attempt** so Recall and Reflect can filter by `verified`.
- **High-skepticism disposition** that questions unverified claims and prefers evidence over plausible-sounding suggestions.
- **Citations (`based_on`)** so Reflect shows which memories it used, making it visible whether a recommendation rests on a `verified` record or only a `proposed` one.

> A suggestion that passed CI once but was never merged is `passed_unmerged`, not `verified`. It remains unverified until merged and green on the target branch.

---

## 7. How should it use memory when a similar failure occurs again? (end-to-end)

1. **New failure arrives.** CI reports `test_refund_retry` timing out on the payment mock.
2. **RECALL.** FlakeTrail queries Hindsight for similar failures (same test area, same mock gateway, same CI provider). It finds the earlier `test_payment_retry` investigation.
3. **REFLECT.** The agent reasons over what came back:
   - It reads raw facts and their statuses.
   - It applies the backend rule: only `verified` fixes may be recommended.
   - It shows `failed` attempts as "tried before, did not fix it."
4. **Recommendation.** FlakeTrail suggests only a `verified` fix, clearly labelled as a suggestion to verify in CI (e.g., *"Reset the payment mock state between tests. Confirmed for test_payment_retry (PR #3342). Verify in CI before merging."*).
5. **Developer verifies.** The developer applies the fix, CI passes, the PR merges.
6. **RETAIN.** The new investigation is saved, including its confirmed outcome. Memory improves for the next similar failure.

---

## Realistic example

This example covers: first failure → first unsuccessful solution → second successful solution → information saved → new similar failure → retrieval.

All SDK/JSON examples are **conceptual only**. Actual implementation follows the current Hindsight TypeScript SDK/API.

### Scenario: Flaky payments tests on CI

#### Phase A — First failure (Day 1)

CI job `build-4021` on `main#189` fails:

```
FAILED payments/service_test.py::test_payment_retry
Error: timeout after 30s waiting for payment gateway mock   // secrets redacted before storage
```

The FlakeTrail agent forms Hypothesis 1: *"The timeout is too low."* Status: `proposed`. Attempt 1: increase timeout to 60s. CI re-run: still flaky. Status: `failed`.

#### Phase B — Second successful solution (Day 2)

The agent forms Hypothesis 2: *"The mock gateway keeps shared state between tests."* Status: `proposed`. Attempt 2: reset mock state between tests in `payments/mock_gateway.py`. CI re-run: green. PR #3342 merged. Status: `verified` — this is a **confirmed fix**.

#### Information saved into Hindsight

```json
{
  "bank": "flake-trail",
  "retain_mission": "Capture CI failures, hypotheses, attempted fixes, file changes, and verification outcomes.",
  "items": [
    {
      "type": "world",
      "text": "CI job build-4021 on pipeline main#189 failed: test_payment_retry timed out after 30s waiting for payment gateway mock.",
      "entities": ["build-4021", "main#189", "test_payment_retry", "payment gateway mock"],
      "tags": ["ci:github-actions", "lang:python", "framework:pytest", "area:payments"],
      "status": "open"
    },
    {
      "type": "experience",
      "text": "I proposed increasing the timeout to 60s for test_payment_retry (Hypothesis 1). CI re-run: still flaky.",
      "entities": ["test_payment_retry"],
      "tags": ["status:failed"],
      "attempt": 1
    },
    {
      "type": "experience",
      "text": "I reset the payment mock state between tests in payments/mock_gateway.py (Hypothesis 2). CI re-run: green. PR #3342 merged.",
      "entities": ["payments/mock_gateway.py", "test_payment_retry", "PR #3342"],
      "tags": ["status:verified"],
      "attempt": 2
    }
  ]
}
```

Only attempt 2 carries `status:verified` and can be labelled a confirmed fix. Attempt 1 carries `status:failed` and is negative evidence.

#### Phase C — New similar failure (Day 10)

CI job `build-4189` fails:

```
FAILED payments/service_test.py::test_refund_retry
Error: timeout after 30s waiting for payment gateway mock
```

#### How Hindsight retrieves the previous investigation

```text
recall(bank="flake-trail", query="test_refund_retry timeout waiting for payment gateway mock", tags=["lang:python","ci:github-actions","area:payments"])
```

- **Semantic** matches "payment gateway mock timeout" to the earlier `test_payment_retry` failure (different words, same meaning).
- **Keyword** matches `payment gateway mock` and `timeout after 30s`.
- **Graph** connects `test_refund_retry` → `payments/service_test.py` → `payment gateway mock` → the earlier investigation.
- **Temporal** finds it within a recent window.
- **Fusion** ranks the earlier investigation highly because multiple strategies agree.

Recall returns the earlier investigation's facts: the failure, Attempt 1 (status: `failed`), Attempt 2 (status: `verified`).

Reflect then reasons:

- Applies the backend rule: only `verified` fixes may be recommended.
- Recommends Attempt 2's fix only as a suggestion to verify in CI.
- Shows Attempt 1 as "tried before, did not fix it."

The developer verifies in CI, the fix merges, and the new investigation is retained — feeding memory for the next failure.

---

## How RETAIN, RECALL, REFLECT fit into the workflow

```text
CI failure detected
     |
     v
[RETAIN] Redact secrets; retain raw failure evidence (not a completed memory yet)
     |
     v
Hypotheses formed (status: proposed) — not confirmed
     |
     v
Fix attempted in CI; result comes back
     |
     v
Save attempt with confirmed status: failed / passed_unmerged / verified
     |
     v
Only verified = confirmed fix (enforced by FlakeTrail backend)
     |
     v
Later: similar CI failure
     |
     v
[RECALL] Find similar past investigations (4 strategies, fused, tag-filtered)
     |
     v
[REFLECT] Reason over returned facts; apply "only verified" rule;
           return recommendation with citations
     |
     v
Developer verifies in CI -> fix merges
     |
     v
[RETAIN] Save new investigation with confirmed outcome
     |
     v
Memory improves for the next similar failure
```

### Honest limits

- Memory is not automatically accurate. A stored "root cause" or stack trace can be wrong. Every recommendation carries citations and must be verified in CI.
- A recalled memory being relevant does not mean it is correct for the new failure. Context (language, CI provider, test area) must still be checked.
- Hindsight ranks by relevance and consensus, not by truth. `verified:true` is the only marker FlakeTrail treats as a confirmed fix, and even that requires the developer's CI verification.

---
