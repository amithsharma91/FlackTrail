# FlakeTrail — MVP Feature List

FlakeTrail is an AI-powered debugging assistant that remembers previous CI failures and investigation outcomes.

This document lists the exact features for the first working version. It is split into three groups:

- **A. Essential features** — required for the product to work.
- **B. Important features** — improve the experience but are not needed to prove the core idea.
- **C. Features we will NOT build** — things that would waste time on version one.

For every feature we explain what it does, why we need it, what the user should see, and how we can test it.

---

## A. Essential features

These features are absolutely required. Without them, FlakeTrail cannot prove its core idea.

### A.1 Upload or paste CI failure logs

| Aspect | Detail |
|--------|--------|
| **What it does** | Lets a developer upload a CI failure log file, or paste log text into a box, and submit it to FlakeTrail. |
| **Why we need it** | This is the entry point. FlakeTrail cannot analyze anything unless it first receives a failure log. |
| **What the user should see** | A simple page with a file upload field and a large text box. After submitting, the user sees a confirmation that the log was received. |
| **How we can test it** | Upload a real CI log file and confirm it is saved. Paste log text and confirm it is saved. Try an empty submission and confirm an error message appears. |

### A.2 Extract useful error information

| Aspect | Detail |
|--------|--------|
| **What it does** | Reads the uploaded or pasted CI log and pulls out the key facts: error messages, stack traces, failing test names, and timestamps. |
| **Why we need it** | Raw CI logs are long and noisy. We need the important error parts so the AI and the developer can focus on what actually failed. |
| **What the user should see** | A cleaned-up summary of the extracted error details shown next to or below the original log. |
| **How we can test it** | Feed a sample CI log and check that error messages, stack traces, and test names are correctly extracted and nothing important is missing. |

### A.3 Retrieve similar historical failures using Hindsight

| Aspect | Detail |
|--------|--------|
| **What it does** | Searches Hindsight (our store of past CI failures and outcomes) for failures that look similar to the current one and returns the matching records. |
| **Why we need it** | The core idea of FlakeTrail is remembering previous failures. We must be able to find past cases that match the current error so developers can learn from them. |
| **What the user should see** | A list of similar historical failures, each showing the error, when it happened, and what investigation was done. |
| **How we can test it** | Insert a few known failures into Hindsight, submit a new log that matches one of them, and confirm the matching record appears in the results. |

### A.4 Use AI to analyze historical and current failures

| Aspect | Detail |
|--------|--------|
| **What it does** | Sends the current error information and the similar historical failures to an AI model, which produces a short analysis of what is likely going wrong. |
| **Why we need it** | AI connects the current failure to past cases and suggests likely causes, which is the main value of FlakeTrail. |
| **What the user should see** | An AI-written analysis paragraph explaining the likely cause and how it relates to similar past failures. |
| **How we can test it** | Submit a failure with known similar history and check that the AI analysis mentions the relevant past case and gives a sensible likely cause. |

### A.5 Display debugging recommendations

| Aspect | Detail |
|--------|--------|
| **What it does** | Turns the AI analysis into a list of concrete debugging recommendations (steps to try, things to check, possible fixes). |
| **Why we need it** | Developers need actionable next steps, not just an explanation. Recommendations make the analysis useful in real work. |
| **What the user should see** | A numbered list of recommendations under the AI analysis, each one a clear action the developer can take. |
| **How we can test it** | Run the analysis on a sample failure and confirm each recommendation is specific, relevant to the error, and safe to try. |

### A.6 Allow developers to record whether a solution worked

| Aspect | Detail |
|--------|--------|
| **What it does** | Lets the developer mark an investigation outcome as "worked" or "did not work" and optionally add a short note about what they did. |
| **Why we need it** | FlakeTrail only improves if it learns which solutions actually worked. This feedback loop is essential to the memory idea. |
| **What the user should see** | Buttons or a dropdown to mark the outcome as worked / did not work, plus a small text box for notes. |
| **How we can test it** | Select "worked" and confirm the choice is saved. Select "did not work" with a note and confirm both are saved. |

### A.7 Save confirmed investigation outcomes into Hindsight

| Aspect | Detail |
|--------|--------|
| **What it does** | When a developer confirms a solution worked, saves that investigation outcome (error, solution, result) into Hindsight so it can be found later. |
| **Why we need it** | This is how FlakeTrail "remembers." Without saving confirmed outcomes, the system cannot help future developers with the same failure. |
| **What the user should see** | A confirmation message that the outcome was saved to Hindsight. |
| **How we can test it** | Mark an outcome as worked, then submit a similar new failure and confirm the saved outcome appears in the similar-failure results. |

---

## B. Important features

These features improve the user experience but are not essential to prove the core idea. We will build them only if time allows after all essential features work.

### B.1 View history of past investigations

| Aspect | Detail |
|--------|--------|
| **What it does** | Shows a list of previous investigations the developer has done, with dates and outcomes. |
| **Why we need it** | Developers often want to look back at what they tried before without re-searching Hindsight. |
| **What the user should see** | A simple table of past investigations with error title, date, and outcome. |
| **How we can test it** | Complete one investigation, then open the history page and confirm that investigation appears in the list. |

### B.2 Simple developer identification

| Aspect | Detail |
|--------|--------|
| **What it does** | Lets the developer enter a name or ID so their feedback and saved outcomes are tied to them. |
| **Why we need it** | Without knowing who recorded an outcome, the feedback is less trustworthy and harder to attribute. |
| **What the user should see** | A name input at the start, or a small profile label next to each recorded outcome. |
| **How we can test it** | Enter a name, record an outcome, and confirm the name is stored with that outcome. |

### B.3 Export investigation results

| Aspect | Detail |
|--------|--------|
| **What it does** | Lets the developer download the analysis and recommendations as a text file. |
| **Why we need it** | Developers may want to attach the results to a ticket or share them with teammates outside FlakeTrail. |
| **What the user should see** | A download button on the results page. |
| **How we can test it** | Click download and confirm the file contains the analysis and recommendations. |

---

## C. Features we will NOT build

These are out of scope for the first version. Building them would take time away from proving the core idea.

| Feature | Reason we are not building it |
|---------|------------------------------|
| Automatic CI/CD integration (webhooks, automatic PR comments) | Requires integrating with many CI systems. Manual upload/paste is enough for version one. |
| Slack, Teams, or email notifications | Adds external integrations and infrastructure. Not needed to prove the core idea. |
| Multi-project or team management with permissions | Adds complexity around users, roles, and access control. Single-user flow is fine for MVP. |
| Fine-tuning or training custom AI models | Expensive and slow. A standard AI model is sufficient for the first version. |
| Mobile app | Web is enough. A mobile app doubles the build and maintenance work. |
| Automated fix generation or auto-applying patches | Too risky for a first version. We only recommend; developers decide and apply fixes themselves. |
| SLA tracking, alerting, or complex dashboards | Operations-focused features, not core to remembering and learning from failures. |
| Self-hosted deployment options | We will deploy to one simple hosting environment. |
| Advanced analytics and charts | Nice for later, but does not help prove that FlakeTrail can remember and reuse past failures. |

---

## How to read priorities

- Build **all of section A** before anything else. These seven features are the minimum working product.
- Start **section B** only after section A is complete and tested.
- Do **not** build anything in **section C** for version one.
