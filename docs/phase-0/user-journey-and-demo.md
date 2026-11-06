# FlakeTrail — User Journey and Demo Planning

**Project:** FlakeTrail — Hack With Bangalore 4.0  
**Purpose:** Explain how a developer uses FlakeTrail and how to demonstrate it to judges.

This document is a plan only. It contains no application code. It describes screens, user actions, application behavior, and demo flow based on the MVP feature list and memory system plan.

---

## 1. Overview

FlakeTrail helps developers debug CI failures by remembering past investigations.

A developer uploads a CI failure log. FlakeTrail extracts the error, finds similar past failures using Hindsight memory, gets an AI recommendation, lets the developer try the fix, and saves the outcome so the next developer can benefit.

**MVP scope only.** No Slack, no email, no mobile app, no auto-fix, no multi-team management.

---

## 2. User Journey

The journey has 9 steps. For each step: what the user does, what the application does, and what appears on screen.

---

### Step 1 — Developer opens FlakeTrail

**What the user does:** Opens the FlakeTrail website in a browser.

**What the application does:** Loads the home page. Shows an empty upload area and a short description of what FlakeTrail does.

**What appears on screen:**
- Page title: "FlakeTrail — Remember CI failures, fix faster."
- A file upload box labeled "Upload CI failure log" or a text area labeled "Paste CI log here."
- A submit button: "Analyze failure."
- A link: "View past investigations" (optional, only if history exists).

```
┌─────────────────────────────────────┐
│  FlakeTrail                         │
│  Remember CI failures, fix faster.  │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ Upload CI failure log […]   │   │
│  │ or paste log text: ________ │   │
│  │                             │   │
│  │      [ Analyze failure ]    │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

---

### Step 2 — Developer uploads a failed CI log

**What the user does:** Selects a CI log file from their computer, or pastes CI log text into the box, and clicks "Analyze failure."

**What the application does:** Receives the log. Validates that it is not empty. If empty, shows an error message. If valid, proceeds to extract error information.

**What appears on screen:**
- A loading indicator: "Analyzing your CI log…"
- If empty: red error box: "Please upload a log file or paste log text."

```
┌─────────────────────────────────────┐
│  FlakeTrail                         │
│                                     │
│  Analyzing your CI log…  [ ⏳ ]     │
│                                     │
└─────────────────────────────────────┘
```

---

### Step 3 — FlakeTrail displays the detected error

**What the user does:** Reviews the extracted error details to confirm they match the CI failure.

**What the application does:** Parses the CI log and extracts: failing test name, error message, stack trace head, timestamps, language/framework, CI provider. Displays these as a clean summary.

**What appears on screen:**
- Heading: "Detected error"
- Test name: `test_payment_retry`
- Error message: `timeout after 30s waiting for payment gateway mock`
- Stack trace head (first few lines)
- CI job ID, branch, commit
- A button: "Find similar past failures"

```
┌─────────────────────────────────────┐
│  Detected error                     │
│                                     │
│  Test:        test_payment_retry    │
│  Error:       timeout after 30s     │
│             waiting for payment     │
│             gateway mock            │
│  CI job:      build-4021            │
│  Branch:      main                  │
│                                     │
│  [ Find similar past failures ]     │
└─────────────────────────────────────┘
```

---

### Step 4 — Hindsight retrieves similar past investigations

**What the user does:** Clicks "Find similar past failures." Waits for results.

**What the application does:** Sends the error signature to Hindsight memory. Hindsight searches using semantic, keyword, graph, and temporal strategies. Returns matching past investigations with their status tags (`proposed`, `failed`, `passed_unmerged`, `verified`).

**What appears on screen:**
- Heading: "Similar past investigations"
- A list of matching past cases. Each shows:
  - Test name
  - Error message
  - Outcome status badge (verified / failed / passed_unmerged)
  - Date
  - PR link (if verified)

```
┌─────────────────────────────────────┐
│  Similar past investigations        │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ test_payment_retry          │   │
│  │ timeout after 30s …         │   │
│  │ Status:  [ verified ]       │   │
│  │ Fixed:   PR #3342           │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ test_refund_retry           │   │
│  │ timeout after 30s …         │   │
│  │ Status:  [ failed ]         │   │
│  │ Tried:   increase timeout   │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

---

### Step 5 — AI studies the retrieved history

**What the user does:** Waits. No action required.

**What the application does:** Sends the current error and the similar past investigations to the AI model. The AI studies which past attempts succeeded or failed and forms a likely cause and recommendation.

**What appears on screen:**
- Heading: "AI is analyzing…"
- Subtext: "Reviewing similar past failures and outcomes…"
- Loading indicator.

```
┌─────────────────────────────────────┐
│  AI is analyzing…                   │
│                                     │
│  Reviewing similar past failures    │
│  and their outcomes…  [ ⏳ ]        │
│                                     │
└─────────────────────────────────────┘
```

---

### Step 6 — FlakeTrail displays recommendations

**What the user does:** Reads the AI analysis and recommendations. Decides which suggestion to try.

**What the application does:** Shows the AI-generated likely cause and a numbered list of concrete debugging recommendations. Each recommendation references the past investigation it came from (e.g., "Confirmed for test_payment_retry in PR #3342").

**What appears on screen:**
- Heading: "AI recommendations"
- Likely cause paragraph
- Numbered recommendations:
  1. Reset the payment mock state between tests. (Confirmed for test_payment_retry, PR #3342)
  2. Increase the timeout to 60s. (Tried before — did not fix it.)
- A note: "Only suggestions marked 'verified' are confirmed fixes. Try in CI before merging."

```
┌─────────────────────────────────────┐
│  AI recommendations                 │
│                                     │
│  Likely cause: The payment mock     │
│  keeps shared state between tests.  │
│                                     │
│  1. Reset the payment mock state    │
│     between tests.                  │
│     ✓ Confirmed fix — PR #3342      │
│                                     │
│  2. Increase timeout to 60s.        │
│     ✗ Tried before — did not fix.   │
│                                     │
│  Try in CI before merging.          │
└─────────────────────────────────────┘
```

---

### Step 7 — Developer investigates the suggested solution

**What the user does:** Applies the recommended fix in their code (e.g., edits `mock_gateway.py`). Runs CI again on the fixed branch.

**What the application does:** Waits. No application action during this step — the developer works in their own editor/CI system. FlakeTrail does not auto-apply patches (out of MVP scope).

**What appears on screen:** FlakeTrail screen remains on the recommendations page, or the developer returns to their IDE/CI dashboard. No screen change required in FlakeTrail.

---

### Step 8 — Developer confirms whether the solution worked

**What the user does:** Returns to FlakeTrail. Chooses an outcome: "Worked" or "Did not work." Optionally adds a short note.

**What the application does:** Shows two buttons: "It worked" and "It did not work," plus a small notes text box. Records the developer's choice.

**What appears on screen:**
- Heading: "Did the solution work?"
- Button: "It worked"
- Button: "It did not work"
- Notes box: "What did you do? (optional)"
- Submit button: "Save outcome"

```
┌─────────────────────────────────────┐
│  Did the solution work?             │
│                                     │
│  [ It worked ]   [ It did not work ]│
│                                     │
│  Notes: ________________________    │
│                                     │
│        [ Save outcome ]             │
└─────────────────────────────────────┘
```

---

### Step 9 — FlakeTrail saves the outcome into memory

**What the user does:** Clicks "Save outcome."

**What the application does:** Saves the investigation outcome into Hindsight memory. If the developer marked "It worked" and CI passed and the change is merged, the status is `verified` — this becomes a confirmed fix. If CI still failed, status is `failed`. The outcome is now available for future similar failures.

**What appears on screen:**
- Confirmation message: "Outcome saved to FlakeTrail memory."
- The saved status badge (verified / failed / passed_unmerged).
- Option to view the saved investigation.

```
┌─────────────────────────────────────┐
│  Outcome saved to FlakeTrail memory.│
│                                     │
│  Status:  [ verified ]              │
│  Fix:     Reset mock state          │
│  PR:      #3345                     │
│                                     │
│  [ View saved investigation ]       │
└─────────────────────────────────────┘
```

---

## 3. End-to-End Journey Diagram

```
Developer opens FlakeTrail
        │
        ▼
Uploads failed CI log  ──►  App validates log
        │
        ▼
App displays detected error  ──►  Developer reviews error
        │
        ▼
Developer clicks "Find similar past failures"
        │
        ▼
Hindsight retrieves similar past investigations
        │
        ▼
AI studies retrieved history  ──►  AI forms likely cause
        │
        ▼
App displays recommendations  ──►  Developer reads suggestions
        │
        ▼
Developer investigates suggested solution (in IDE/CI)
        │
        ▼
Developer confirms outcome (worked / did not work)
        │
        ▼
App saves outcome to Hindsight memory
        │
        ▼
Memory available for next similar failure
```

---

## 4. Demonstration Plan for Judges

### Goal

Show judges that FlakeTrail remembers past CI failures and helps developers reuse historical knowledge. The demo must prove memory works — not just generic AI.

### Demo scenario: Flaky payments tests on CI

We demonstrate one continuous story:

| Phase | What judges see |
|-------|-----------------|
| A | An old failure saved into memory (Day 1) |
| B | A previous unsuccessful attempt (still flaky) |
| C | A previously confirmed successful fix (verified, merged) |
| D | A new similar failure |
| E | Hindsight retrieves historical information |
| F | AI generates a recommendation using that information |
| G | A new outcome being saved |

---

### Demo setup (before judges arrive)

The demo environment must already contain:

1. **Past investigation 1 (old failure):** `test_payment_retry` timed out. Attempt: increase timeout to 60s. Result: still flaky. Status: `failed`.
2. **Past investigation 2 (confirmed fix):** Same test. Attempt: reset payment mock between tests. Result: CI green, PR #3342 merged. Status: `verified`.

These are pre-loaded into Hindsight memory before the demo. We do **not** create them live during the demo (to save time and avoid failures).

---

### Demo flow (live, ~5 minutes)

#### Part 1 — Show memory already exists (30 seconds)

- Open FlakeTrail.
- Show the "Similar past investigations" section pre-populated with two cases:
  - `test_payment_retry` — timeout — `failed` — increase timeout did not work.
  - `test_payment_retry` — timeout — `verified` — reset mock state, PR #3342.
- Tell judges: "These are real past investigations saved into FlakeTrail memory."

#### Part 2 — New similar failure (1 minute)

- Upload a new CI log: `test_refund_retry` — timeout after 30s waiting for payment gateway mock.
- FlakeTrail extracts: test name, error message, CI job ID.

#### Part 3 — Hindsight retrieves history (30 seconds)

- Click "Find similar past failures."
- Hindsight returns the two past `test_payment_retry` investigations because they share the same error signature and mock gateway.
- Show the list: one `failed`, one `verified`.

#### Part 4 — AI recommendation (30 seconds)

- Click to analyze.
- AI shows:
  - Likely cause: shared mock state between tests.
  - Recommendation 1: "Reset the payment mock state between tests. ✓ Confirmed fix — PR #3342."
  - Recommendation 2: "Increase timeout to 60s. ✗ Tried before — did not fix."
- Judges see that FlakeTrail recommended the verified fix, not the failed attempt.

#### Part 5 — Save new outcome (1 minute)

- Developer (demo presenter) says: "I applied the fix. CI passed. PR #3345 merged."
- Click "It worked." Add note: "Reset mock state between tests."
- Click "Save outcome."
- Confirmation: "Outcome saved. Status: verified."
- Show that this new investigation is now in memory for the next similar failure.

---

### Demo script (what the presenter says)

| Time | Presenter says |
|------|----------------|
| 0:00 | "FlakeTrail remembers CI failures so developers don't debug the same problem twice." |
| 0:30 | "Here is memory from past investigations. One attempt failed. One attempt was verified and merged." |
| 1:00 | "Now a new CI failure comes in: test_refund_retry, same timeout error." |
| 1:30 | "FlakeTrail finds the past test_payment_retry cases — same mock gateway, same timeout." |
| 2:00 | "AI recommends resetting the mock state — that's the verified fix. It also shows the timeout increase was tried and failed." |
| 2:30 | "The developer applies the fix, CI passes, PR merges. We save the outcome as verified." |
| 3:00 | "Next time this failure happens, FlakeTrail will remember this fix too." |

---

### What judges must NOT see

- No fake CI results presented as real memory. All pre-loaded investigations are clearly labeled as demo data.
- No auto-applied patches. The developer applies fixes manually.
- No Slack, email, or mobile features (out of MVP scope).
- No complicated analytics or dashboards.

---

## 5. Essential Screens

The website needs only these screens. No more.

| Screen | Purpose | Key elements |
|--------|---------|--------------|
| **Home / Upload** | Entry point | File upload box, text paste area, "Analyze failure" button. |
| **Detected error** | Show extracted error | Test name, error message, stack trace head, CI job ID, "Find similar past failures" button. |
| **Similar past investigations** | Show memory results | List of past cases with test name, error, status badge (`verified` / `failed` / `passed_unmerged`), date, PR link. |
| **AI recommendations** | Show AI advice | Likely cause, numbered recommendations, each tagged with source (verified/failed), note to verify in CI. |
| **Confirm outcome** | Record developer feedback | "It worked" / "It did not work" buttons, optional notes box, "Save outcome" button. |
| **Outcome saved** | Confirmation | Success message, saved status badge, link to view saved investigation. |

No login screen, no profile page, no settings page, no analytics dashboard, no team management screen — all out of MVP scope.

---

## 6. Screen Flow Diagram

```
[Home/Upload] ── upload log ──► [Detected error] ── click find ──►
[Similar past investigations] ── click analyze ──► [AI recommendations]
                                                     │
                                                     ▼ (developer tries fix in IDE)
                                                     │
[Confirm outcome] ◄── return to FlakeTrail ◄─────────┘
        │
        ▼
[Outcome saved]
```

---

## 7. Honest Limits (for demo transparency)

- FlakeTrail ranks by relevance, not truth. A `verified` badge means CI passed and the change was merged — but the developer must still try it in their own CI.
- Memory is not automatically accurate. A stored root cause can be wrong. Every recommendation carries a source reference so judges can see where it came from.
- The demo uses pre-loaded demo data. Live CI runs are not part of the demo to avoid network failures.

---
