# FlakeTrail — Problem Definition

**Project:** FlakeTrail — Hack With Bangalore 4.0  
**Audience:** Project coordinator (beginner-friendly, simple English)  
**Purpose:** Explain the problem FlakeTrail solves. This document contains no code and proposes no new features.

---

## 1. Who will use FlakeTrail?

FlakeTrail is built for **software developers** who work on projects that use Continuous Integration (CI).

### Primary users
- **Software developers** — people who write code and submit it to a shared code repository.
- **Quality assurance (QA) engineers** — people who run tests to check that software works correctly.
- **DevOps engineers** — people who manage the CI pipeline that automatically builds and tests code.

### When they use it
A developer uses FlakeTrail when a CI test fails after they push code, and they need to figure out why and how to fix it.

---

## 2. What problem do software developers face when CI tests fail?

When code is pushed to a shared repository, a CI system automatically runs tests. If a test fails, the developer receives a failure report. The developer then has to:

1. Read the CI failure log to understand what went wrong.
2. Reproduce the failure locally on their own computer.
3. Form hypotheses about what might be causing the failure.
4. Try different fixes one by one.
5. Re-run CI to check if the fix worked.
6. Repeat until the test passes.

This process can be slow and frustrating, especially when the failure is hard to reproduce or when the error message is unclear.

---

## 3. Why do developers waste time investigating recurring failures?

Developers waste time on recurring failures for several reasons:

### Failures happen more than once
The same test can fail in the same way across different days, different code changes, or different developers. When a failure repeats, the investigation starts from scratch each time.

### Knowledge is not stored
When a developer solves a failure, they often remember the fix personally, but they may not write it down where others can find it. If another developer (or the same developer, months later) hits the same failure, they must investigate it again as if it were new.

### Error messages can be unclear
CI failure logs are often long and technical. A developer may spend time reading through the log only to find that the important clue was buried in the middle.

### Reproducing failures is difficult
Some failures happen only in the CI environment and not on a developer's personal computer. This makes it hard to test fixes quickly.

### Multiple people may investigate the same failure
In a team, more than one developer might encounter the same failing test without knowing that a teammate already solved it. Each person repeats the same investigation.

---

## 4. Why is remembering previous debugging investigations useful?

Remembering past investigations helps because:

- **Past failures are a useful reference.** If a test failed before and was fixed, the solution to that earlier failure is likely relevant to the current one.
- **Failed attempts are also useful.** Knowing what was already tried and did not work prevents developers from repeating the same mistakes.
- **Time is saved.** A developer can start from what is already known instead of beginning the investigation from zero.
- **Team knowledge is preserved.** When one person solves a difficult problem, the solution becomes available to the whole team, not just to that person.
- **Similar failures are easier to recognize.** Even if two failures are not identical, seeing how a similar one was resolved gives developers a place to start.

---

## 5. How do developers typically handle this problem today?

Today, without a tool like FlakeTrail, developers handle CI failures using manual methods:

### Common current practices
- **Reading CI logs manually.** Developers open the CI dashboard, find the failed job, and read the log output.
- **Asking teammates.** A developer messages a colleague to ask if they have seen the same failure before.
- **Searching chat history.** Developers search team chat or email for mentions of the same error message.
- **Keeping personal notes.** Some developers write down fixes in personal notebooks, text files, or local documents that others cannot access.
- **Re-investigating from scratch.** If no one remembers the failure, the developer investigates it as though it had never happened before.

### Limitations of current practices
- These methods rely on human memory, which is unreliable.
- Personal notes are not shared with the team.
- Chat history is hard to search and may be deleted.
- There is no central place where failed attempts and confirmed solutions are stored together with context.

---

## 6. How is FlakeTrail different from a normal AI chatbot?

A normal AI chatbot answers questions based on general training data. It does not know about a specific team's CI history unless that information is pasted into the chat.

FlakeTrail is different because:

- **It stores team-specific memory.** FlakeTrail remembers failures, investigations, and solutions from that team's own CI history.
- **It connects failures to outcomes.** It does not just explain an error; it records what was tried, what failed, and what was confirmed to work.
- **It retrieves relevant history automatically.** When a new failure looks similar to an old one, FlakeTrail surfaces the past investigation instead of requiring a developer to remember or search for it.
- **It distinguishes confirmed fixes from suggestions.** FlakeTrail records whether a solution was actually verified (CI passed and the change was merged) or just proposed but not proven.

A chatbot can give general advice. FlakeTrail gives advice grounded in the team's own verified history.

---

## 7. Realistic example of a developer experiencing this problem

### The scenario

Maya is a software developer working on an e-commerce application. Her team uses a CI pipeline that runs tests every time code is pushed.

On Tuesday morning, Maya pushes a small change to the payment page. Five minutes later, she receives a notification: CI job `build-4021` failed. The failing test is `test_payment_retry`.

Maya opens the CI log. The error says:

```
Error: timeout after 30s waiting for payment gateway mock
```

### Maya's investigation

1. **Read the log.** Maya reads the failure log but does not immediately understand why the payment gateway mock is timing out.
2. **Ask a teammate.** She messages her colleague Arjun: "Hey, have we seen a timeout on the payment gateway mock before?" Arjun replies: "I think so, a few weeks ago, but I don't remember the fix."
3. **Search chat.** Maya searches the team chat for "payment gateway mock timeout". She finds a message from two months ago where someone mentioned the same error, but the thread does not include the solution.
4. **Reproduce locally.** Maya tries to run the test on her laptop. It passes locally, so she cannot reproduce the failure.
5. **Try a fix.** She guesses the timeout is too short and increases it from 30 seconds to 60 seconds. She pushes the change. CI runs again. The test still fails.
6. **Try another fix.** She looks at the mock gateway code and resets its state between tests. She pushes again. CI passes.
7. **Merge.** Maya opens a pull request, gets it reviewed, and merges.

### The problem

Two weeks later, another developer, Liam, pushes a change to the refund page. CI fails with the same error:

```
Error: timeout after 30s waiting for payment gateway mock
```

Liam does not know about Maya's fix. He repeats the whole investigation: reads the log, asks teammates, searches chat, tries increasing the timeout (which fails again), and finally resets the mock state between tests — the same fix Maya found.

Liam wasted time because Maya's solution was not stored where he could find it. If FlakeTrail had recorded Maya's verified fix, Liam could have seen it immediately and saved hours of work.

---

## Known facts vs. assumptions

The table below separates what is generally known from what is assumed for the purposes of planning FlakeTrail.

| Known facts | Assumptions |
|-------------|-------------|
| CI systems automatically run tests when code is pushed to a shared repository. | Developers on a team will use FlakeTrail consistently. |
| CI failure logs contain error messages and stack traces. | Storing past investigations will reduce the time developers spend on recurring failures. |
| Some CI failures happen only in the CI environment and not on a developer's computer. | Developers will mark outcomes as "worked" or "did not work" after trying a fix. |
| Developers often ask teammates or search chat history when they encounter a familiar error. | A verified fix (CI passed and change merged) is more trustworthy than an unverified suggestion. |
| Human memory is unreliable for recalling details of past debugging sessions. | Teams want to avoid repeating the same failed attempts. |

---

## Summary

FlakeTrail addresses a real problem: developers repeatedly investigate the same CI failures because past debugging knowledge is not stored, shared, or easily retrieved. By remembering previous investigations — including what failed and what was confirmed to work — FlakeTrail helps developers fix recurring failures faster and avoid repeating work that has already been done.

---
