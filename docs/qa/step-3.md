# QA sign-off: Step 3 (quizzes, wrong-answer tracking, weak topics, ask your notes)

**Result: PASS** (2026-10-18). Two High and several Medium bugs were found and fixed on `claude/step-3` (listed below). The open items are Medium or Low and go to the security engineer and the developer. None of them blocks a student test in demo mode. Still to run: a real Groq key, real phones and a live Supabase project (last section).

## Automated
| Suite | Result |
|---|---|
| Lint, typecheck, production build | Clean |
| Unit (Vitest) | 434 passed in 25 files (421 before QA, 13 added) |
| E2E (Playwright, desktop Chrome and Pixel 7), full run | 112 passed, 2 skipped (keyboard shortcuts on mobile, by design). Run twice on the final commit: default workers (5.5 min) and `--workers=4` (4.0 min). Both were green. |
| Flaky-test stress run (mindmap test plus the Step 3 specs, 6 repeats, 4 workers) | 120 of 120 passed |
| Accessibility (axe, WCAG 2.1 AA), dark mode with reduced motion | 0 violations on these screens: Make a quiz ("Quiz ready!"), a question, "I don't know" feedback, results, weak topics, quiz shelf, subject page, a chat answer and the citation preview |
| DB (`npm run test:db`, local Postgres 16 with pgvector, throwaway database `studynest_qa`) | GRANT TESTS PASSED, ALL RLS TESTS PASSED |

## Flaky `[desktop] e2e/step2.spec.ts:128 mindmap`
**Cause: a real bug.** Step 3 did not change the mindmap. It made the full run heavier, and that exposed the bug.

`MindmapScreen` was keyed on the map's `createdAt`. After making a map, the screen calls `router.refresh()`. When that refresh landed, the new key remounted the screen. The remount closed the open passage panel, moved focus to the body and dropped any pending layout save. On an idle machine the refresh lands before the test clicks. In a full run the single shared server is busy with Step 3's tests, so the refresh lands mid-test.

**Proof:** a new test, "mindmap: a late refresh after making it keeps the open passage and the layout save" in `e2e/step2-qa.spec.ts`, holds back the refresh by 3 s. It failed on both viewports before the fix and passes after.

**Fix (`43a052c`):** the page is keyed on the subject. The screen only adopts a map from the server when that map is newer than the one it shows. There are no retries and no skips.

## Accuracy of the quiz and chat normalisers
**Sample:** a labelled set of realistic model outputs, good and bad, on four passages (cell biology, neurons, enzymes and chemistry, genetics). It lives in `src/lib/ai/quiz-chat-quality.qa.test.ts` and runs in CI.

| | Good kept | Bad dropped (before QA) | Bad dropped (after) |
|---|---|---|---|
| Quiz questions | 18 / 18 | 15 / 22 | 22 / 23 |
| Chat answers | 14 / 14 | 10 / 14 | 15 / 16 |

**What got through before:** `isGrounded` checks that every word and number appears in the passage. It cannot see a sentence that copies a passage run and swaps in one term from elsewhere in the same passage. Examples:
- "Efferent neurons carry impulses towards the CNS"
- "Mitosis produces four haploid gametes"
- "work best at 45 °C"
- "3′ to 5′"

It also let through a species whose genus is not in the notes, and "Two" and "2" as two separate options.

**Fix (`3950d3c`):** a new `contradictsPassage()` in `src/lib/ai/contradict.ts` runs on:
- fill-in sentences
- explanations
- each cited chat sentence

Two smaller fixes: species need their genus in the notes, and number words count as their digits in the option check. The one bad chat answer still counted as kept is an HTML answer: its true sentence is kept and the markup is removed, which is the right outcome.

**Still gets through (Low, documented):**
- An MCQ whose key comes from the neighbouring clause and whose explanation is paraphrased.
- Chat answers are not checked for meaning beyond swapped terms.

## What was covered
**Answers hidden until checked**
- An e2e test intercepts every response on the quiz pages and checks that none of these appear before an answer is checked: `correctIndex`, `correctChoice`, `explanation`, `accepted`, `sourceQuote`, `answer`, `quote`. They do appear after checking.
- The results action refused nothing for an unfinished attempt (fixed, see bugs).
- Checking is idempotent:
  - A retry with the same client key returns the first result.
  - A second check with a new key returns the first answer.
  - Two taps at once save one answer and one miss.
  - A key already used on another question is refused.

**Fill-in matcher**
- About 43 minimal pairs must be refused. Examples: afferent/efferent, nitrate/nitrite, ethane/ethene, lactose/lactase, ligase/lipase, neuron/neutron, S phase/M phase, vitamin D/E, α/β cells.
- Real misspellings must still be accepted: hypothalmus, glycolisis, mitochondira.
- Also covered: plurals, units, number words ("five" = 5) and thousands separators.

**Weak topics**
- Rules covered:
  - A miss opens or adds to a topic.
  - Right answers build a streak.
  - Three right answers clear a topic.
  - "Got it" and "reopen" work.
- "I was right" and "Report a problem" each take a miss back. This now happens exactly once and never undoes later progress (fixed).
- Re-mix: "Practise what I missed" works after a resumed attempt (e2e).
- Topic keys match the database (fixed).

**Chat**
- The not-covered path makes no model call and uses no go.
- Citations are built with `passageHref`.
- Only the last 4 messages are sent.
- Questions are capped at 500 characters (zod and the UI).
- Answers render as React text nodes. The app's only `dangerouslySetInnerHTML` is the theme script.
- An e2e test types `<img onerror>` and `<b>` into a note. They stay text in the answer and the citation preview, and no script runs.

**Limits**
- Quizzes: 3 a day and 9 tries. Chat: 20 a day and 60 tries.
- A failed call gives the go back.
- The same settings again cost nothing.
- Checked in the action tests and by reading the code.

**Phones, themes, keyboard, sound**
- 375 px: e2e checks for no sideways scroll and 44 px touch targets on the shelf, a question, results, weak topics and chat.
- Dark mode and reduced motion: axe as above. With reduced motion there is no shake and no confetti.
- Keyboard: numbers choose, Enter checks and moves on, `/` focuses the chat, Shift+Enter adds a line (e2e).
- Sound, checked by code review:
  - Check plays only the result sound.
  - "I don't know" plays no boop.
  - Focus (calm) mode turns off the shake and the confetti.
  - Every control uses `useSound()`.

## Bugs found and fixed
| # | Severity | Bug | Steps to reproduce (before) | Fix |
|---|---|---|---|---|
| 1 | High | "Retake this quiz" refused every answer with "That answer was already used. Reload the quiz." | Finish a quiz, then Retake this quiz, then answer any question | `ed33650`: client keys are per attempt and question. New e2e test: retake |
| 2 | High | The results of an unfinished attempt could be fetched. They include every right answer, accepted answer and explanation. | Start a quiz, then call `attemptResults(attemptId)` before answering | `7cbd59b`: refused until the attempt is finished |
| 3 | Medium | Weak topics on Supabase: a topic with superscripts, ligatures or full-width letters (for example "Ca²⁺") broke checking an answer. The app's `topicKey` applied NFKC ("ca2+") but the database's generated `topic_key` did not ("ca²⁺"). The lookup missed and the insert hit the unique key. | Supabase mode, a quiz whose topic is "Ca²⁺", miss it twice | `e3c0c83`: `topicKey` no longer applies NFKC. The test checks against values from Postgres 16 |
| 4 | Medium | Fill-in typo allowance accepted a different science term one letter away. Examples: "efferent" for afferent, "nitrite" for nitrate. | Fill-in answer "afferent", type "efferent" | `8fe02ad` |
| 5 | Medium | Swapped passage terms in quiz fill-ins, explanations and chat (see accuracy) | See the sample | `3950d3c` |
| 6 | Medium | "I was right" after "Report a problem" took the miss back a second time, removing a miss from another attempt. It also worked on a deleted quiz. | Miss question Q in two attempts, report Q in the second, then press "I was right" | `c527b2a` |
| 7 | Medium | "I was right" on an older miss reopened a cleared topic or wiped a later streak | Miss, then 3 right answers (topic cleared), then override the old miss | `437c913` |
| 8 | Medium | Edit question: "1,200" in "Other answers that count" was split into "1" and "200", so "1" was accepted. A question with more than 6 other answers could no longer be edited, because overrides can grow it to 10. | Override with "1,200", then Edit question, then Save | `cba4cb5` |
| 9 | Medium | Flaky mindmap test: a late refresh remounted the screen (see above) | Delayed-refresh e2e test | `43a052c` |

## Open issues
**Security engineer**
- **Medium:** `ai_cache` has an own-rows select policy, and `authenticated` keeps Supabase's default table grants (checked on the local DB). A student can therefore read the cached quiz output, with every answer, using their own JWT, before taking the quiz.
- **Low:** `questions.source_quote` is granted to students, and the quote usually contains the answer.

Both items only expose the student's own data, so the risk is cheating on your own quiz. Either the server-only rule needs a revoke or column grant, or the spec should accept it.

**Developer (Low)**
- In Supabase, JS `toLowerCase` and Postgres `lower()` still differ for a word-final Greek sigma and for a dotted capital I. A topic like "ΣΟΦΟΣ" could still hit the unique key. The best fix is to look the row up in the database, for example with an upsert on `(subject_id, user_id, topic_key)`.
- The `accepted_json` 2000-byte check can be exceeded by 10 answers of 60 multi-byte characters each.
- A chat follow-up calls `retrieve` twice, which doubles the embed calls.
- `shelf()` filters quizzes × attempts, which is O(n·m).
- These are duplicated:
  - `rangeLabel` duplicates `pagesText`.
  - The usable-chunk filter is in two places.
- The S2-15 timing test in `injection.test.ts` fails only when the machine is under heavy load (load average 16) and passes when idle. It is worth a wider margin.

## Not tested yet
- Real Groq output. The sample uses hand-written realistic outputs; the e2e runs use the local generator.
- Real phones and screen readers (VoiceOver, TalkBack). Touch is only emulated on Pixel 7.
- Audible sound output (headless).
- A live Supabase project. RLS and grants were tested on a local Postgres only; the live database was not touched.
