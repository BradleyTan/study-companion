# QA sign-off: flashcards from any pages (up to 50), 15 a day, duplicate skipping, card quality and accuracy

**Result: PASS** (2026-10-17), with the open issues below. None of them is high or critical. QA found 6 bugs and fixed them on the branch, together with the accuracy work Bradley asked for ("biology terms, equations and terms must be captured accurately"). Because QA changed grounding and extraction code (`src/lib/ai/text.ts`, `schemas.ts`, `src/lib/extract/`), **a security pass on commits 6013ae2..df7382f is still needed before merge**. Security has reviewed only the `resolvePassage` change; it is fine.

Spec: `docs/design/screens/flashcards.md` (Changelog 2026-10-17). Feature commits: e02971a..950a499 on main 93c575c. Security commits: 7da45f2, 3cd498c. QA commits: 6013ae2, 36735a3, 65a8947, 5924787, df7382f, and the docs commit with this file.

## Automated
| Suite | Result |
|---|---|
| Typecheck, lint, production build | Clean |
| Unit (Vitest) | 262 passed, 18 files. QA added `src/lib/ai/card-quality.qa.test.ts` (labelled card samples, science full path, regressions), extraction tests (science PDF, Word-style scripts, PPTX baselines, hyphens, linear time) and `speakable` tests |
| E2E (Playwright, desktop Chrome + Pixel 7) | 4 full runs, all green, no flakes. Run 1 (feature as delivered): 76/76 in 3.7 min. Runs 2 and 3 (with QA's tests): 80/80 in 3.4 and 3.6 min. Run 4 (final HEAD df7382f, after a clean `npm run build`): 80/80 in 3.4 min. QA added `e2e/step2-science.spec.ts` and a whole-file "all already in your deck" journey in `e2e/step2-pages-qa.spec.ts` |
| Accessibility (axe, WCAG 2.1 AA) | 0 violations on the new journeys (quick picks, overlap, all-skipped, science deck) |
| `/code-review` (93c575c..HEAD, medium) | 10 findings. 8 fixed in df7382f. 2 were style or duplication points and were folded into the same fix |

### The developer's flags
- **The long "goes run out" e2e test** (15 sets on a 60-page file): it took 14.8 s on desktop and 21 s on mobile in every run. The whole suite takes about 3.5 min with the build included, so CI time is fine. It passed in all 4 runs; it is not flaky.
- **Overlap and dedupe in demo mode depend on the fixture's repeating pages.** Confirmed. The fake generator is deterministic and the fixture repeats every 14 pages, so 1–20 followed by 15–34 skips exactly the repeated cards. With the real model, duplicates only match when the questions are worded the same once normalised. A rephrased question from an overlapping range ("Define osmosis." vs "What is osmosis?") is **not** skipped. See issue L3.
- **"(some passages sampled)" only lasts one dialog session.** Confirmed. The sampled flag is kept in a `useRef` and is not stored with the coverage. After a reload, a covered set made after an earlier sampled one shows "Pages 1–25 of 60 done" without the note. See issue L1.
- **375 px hints:** checked by hand at 375 × 740 with touch emulation, on Step 1 with every hint line showing ("You've made cards…", the sampled hint, "Want every passage? Use pages 15–19", "Cards you already have will be skipped.") and on the result step (progress, Next, stacked buttons). No sideways scroll and no target under 44 px. Screenshots checked.
- **PPTX "slides" strings:** every new string takes the unit. Quick picks are unit-tested ("20 slides", "All 42 slides"), as are the range error and coverage text. The e2e test covers legend, fields, hint and quick picks on the 12-slide deck. One bug: the "all already in your deck" message for a whole file said "pages" even for slides (B4, fixed).

## Card quality and accuracy (Bradley: quantity and quality equally; captured information must be accurate)
Method: a human-labelled sample of cards a model could plausibly write, run through `normaliseFlashcardsWithStats`, the real filter.
- **General sample** (biology, chemistry, history, German with decimal commas, astronomy, economics): 37 good cards and 19 bad ones. Bad means wrong number, invented term, outside knowledge, or a non-answer.
- **Science sample, full path**: `e2e/fixtures/science-lecture.pdf` → `extractFile` → chunks → `toPassages` → filter. 38 good cards and 17 bad ones (changed formula, coefficient, charge, exponent, sign, Greek letter, gene, species or unit prefix; ⇌ changed to →).

| | As delivered | After QA fixes |
|---|---|---|
| General: good cards wrongly dropped (false drops) | **9 of 38 (24 %)** | **1 of 37 (3 %)** |
| General: bad cards kept (false keeps) | 7 of 18 (39 %) | 4 of 19 (21 %) |
| Science: good cards wrongly dropped | not measured; most would drop (H2O vs H₂O, 10^23, mmol·L⁻¹) | **0 of 38** |
| Science: bad cards kept | — | **0 of 17** |

False drops in the delivered filter, all now kept:
- `H2O` / `H2SO4` written with ASCII digits when the passage has subscripts.
- `6.022 × 10^23` written with a caret.
- `100 000` with a space as the thousands separator.
- `5 years` for "five years".
- `4%` for "4.0%".
- `Down to −140 °C`: one filler word plus a number.
- `Mitochondrion` for "mitochondria".

Still dropped, by design:
- An honest synonym-only paraphrase ("regulates body heat" for "maintained … temperature").
- A derived number (6.1 points from 10.1 % − 4.0 %). It can't be checked against the passage, so dropping it is the accuracy-first choice.

Bad cards still kept (known limitations of a word-level check, low risk):
- A wrong number that appears elsewhere in the same passage ("lower limit 7.45" when the range is 7.35–7.45; "inflation 5.25 %" when 5.25 % is the base rate).
- One invented term among enough grounded words ("cristae").
- An unsupported comparison built from grounded words ("Phobos is the larger").

Possible next step, not done: check the answer's numbers against the model's **quote** when the quote is verified, rather than against the whole passage.

What the grounding check enforces now (`isGrounded`, `src/lib/ai/text.ts`), comparing in canonical form (NFKC, superscripts as `^`, one minus sign, arrows unified, lower case):
- **Numbers** must be in the passage, with their sign. +70 is not −70. A range dash is not a minus sign. 4 = 4.0, "five" = 5. An answer that says minus, negative or below may give the size of a negative number.
- **Terms mixing letters and digits** must be in the passage: H₂O = H2O, but C₆H₁₂O₅ ≠ C₆H₁₂O₆, BRCA2 ≠ BRCA1, p63 ≠ p53, and 5O₂ is not a coefficient the passage gives.
- **Charges and powers** must match: Ca³⁺ ≠ Ca²⁺, mc³ ≠ mc².
- **Greek words and compounds** must match: β-helix ≠ α-helix.
- **Equations** around `=`, `→` or `⇌` must appear in the passage as written, ignoring spacing. ΔH + TΔS ≠ ΔH − TΔS, and → ≠ ⇌ (the reversibility is lost).
- **Species names** must match: Homo erectus ≠ Homo sapiens, E. faecalis ≠ E. coli.
- **The unit after a number** must match (µm ≠ mm), and so must **number scales** (million ≠ billion).
- **Non-answers** that only repeat the question's words are dropped.
- **Short imperative prompts** ("Define osmosis") are kept. As delivered they were dropped as "not a question".

Prompt: a new rule tells the model to copy names, formulas, equations, symbols and units exactly, with Unicode sub/superscripts. It must not round, convert units or rewrite equations, and must use plain text (no Markdown, LaTeX or italics markers).

### Extraction fidelity (science-lecture.pdf, `make-science-lecture.py`)
- **Unicode text** (LaTeX or Google Docs style PDFs): every string kept exactly. Checked: binomial names, BRCA1, p53, Na⁺/K⁺-ATPase, 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂, SO₄²⁻, Ca²⁺, H₂CO₃ ⇌ H⁺ + HCO₃⁻, ΔG = ΔH − TΔS, E = mc², pH = −log[H⁺], α-helix, β-sheets, −70 mV (a real minus sign), 7.35–7.45, 37 °C, 5.5 mmol·L⁻¹, 0.012 s⁻¹, 104.5°. One change: µ (micro sign) comes out as μ (Greek mu). They look the same, and grounding treats them as equal.
- **Word-style PDFs** (sub/superscripts drawn as small, shifted ordinary digits): as delivered, the subscripts were flattened (harmless: "C6H12O6") but **superscripts were flattened into wrong numbers: "3.0 × 10⁸ m/s" became "3.0 × 108 m/s"**, and "Ca²⁺" became "Ca2+". Fixed (B1). Page text is now built from PDF.js text items, and a smaller run raised or lowered against the line's baseline becomes Unicode super/subscripts (only when every character has one, so "1st" stays). The "ﬁ" ligature already came out as "fi".
- **PPTX**: superscript/subscript runs (`baseline` attribute) were flattened the same way, and `<a:br/>` line breaks glued words together. Both fixed (B1).
- **Line-end hyphens**: "α-\nhelix" became "αhelix" and "3-\nphosphate" became "3phosphate". These now keep their hyphen. "Mito-\nchondria" and "(cyto-\nplasm)" are still re-joined. Known limitation: "Gram-\nnegative" becomes "Gramnegative", the same as before this change.

### Display and read-aloud
- **Display**: cards show every character exactly, front and back, after a save and after a reload (e2e). Atkinson Hyperlegible (latin subset) has no Δ, α, ₂, ⁺ or ⇌, so those glyphs fall back. The body font stack now names free system math/symbol fonts before the generic family: Segoe UI Symbol, Cambria Math, STIX Two Math, Noto Sans Math, DejaVu Sans. Screenshot checked: no missing-glyph boxes. Cosmetic: those glyphs come from a different typeface than the surrounding text, and a long equation can wrap at its `=` sign.
- **Read-aloud** now speaks notation instead of skipping or garbling it ("6CO 2 + 6H 2 O gives C 6 H 12 O 6 + 6O 2", "Ca 2 plus", "10 to the power minus 3", "delta G equals delta H minus T delta S", "minus 70 mV", "37 degrees Celsius", "10 to 30 micrometres", "minus log concentration of H plus"). Only the spoken text changes; what is shown and highlighted is unchanged. The e2e test checks that the utterance has no sub/superscript, arrow or Δ characters left in it.

## Bugs found (all fixed on the branch)
| # | Severity | Bug | Steps to reproduce | Fix |
|---|---|---|---|---|
| B1 | **High** (accuracy) | Superscripts in Word-made PDFs and in PPTX became wrong numbers in passages and cards ("10⁸" → "108", "Ca²⁺" → "Ca2+"). PPTX line breaks glued words | Upload a Word-exported PDF with "3.0 × 10<sup>8</sup> m/s" and open its source page | 6013ae2 |
| B2 | **High** (quality/quantity) | The grounding filter dropped 24 % of good cards and nearly all faithful formula cards (H2O vs H₂O, 10^23, 4% vs 4.0%, "5" vs "five", 100 000, Latin plurals). It also let through sign flips (+70 mV), changed formulas and coefficients, wrong charges, swapped Greek letters, wrong species, wrong unit prefixes, million vs billion, and non-answers | `card-quality.qa.test.ts` (sample above) | 36735a3, df7382f |
| B3 | Medium | Sentences split at decimals and at "E. coli": fake-generator cards were cut mid-number ("The normal pH of _____ blood is 7"), and fallback quotes in real AI mode were cut the same way | Make cards in demo mode from "pH of arterial blood is 7.35–7.45" | 36735a3 |
| B4 | Low | The "every card already in your deck" message for a whole file (no page range) said "Every card from these pages … Try some new pages", and said pages for PPTX too | heart.pdf: make with "About 15", then again with "About 10" | 5924787 |
| B5 | Medium | Short imperative fronts ("Define osmosis", "Name the enzyme") were dropped as "not a question" | `cardQualityIssue("Define osmosis", …)` | df7382f |
| B6 | Low | A passage ref the model wrote loosely ("passage 2", "p1, p2") now drops the card. If every card does this, the whole set fails | Model reply with `"passage": "passage 2"` | df7382f (only passages the server sent; security checked this) |
| B7 | Low | All-skipped path: `settled = true` was set before `await settleAi`, so a failed settle never refunded the go | Code review | df7382f |

Also fixed in df7382f, from the code review of QA's own first version: an unanchored hyphen re-join regex (quadratic on long runs with no spaces) and a species check that treated "The nucleus" as a genus and epithet. Both are covered by unit tests. Grounding on a 14,000-character pathological passage now takes milliseconds; QA's first version took 0.8 s per call.

## Open issues (not fixed; for Bradley, the designer or the developer)
| # | Severity | Issue |
|---|---|---|
| L1 | Low | "(some passages sampled)" lasts only one dialog session (it is not stored with the coverage), so after a reload the progress line can leave it off although an earlier set was sampled. Fixing it needs a storage format change (designer: spec says the key is pairs only) |
| L2 | Low | Bad cards still kept: a wrong number that appears elsewhere in the same passage, one invented term among grounded words, unsupported comparisons. Suggested: check numbers against the verified quote |
| L3 | Low | Duplicate skipping only matches identically worded questions. With the real model, an overlapping range can add the same fact with different wording. Notes are never deduplicated, so making a note again with a higher card count repeats the cards (as the spec says) |
| L4 | Low | Demo/fake generator cards include page headings ("What is Lecture 5, page 1: enzymes Point 1: enzymes?"). Demo only; the real prompt asks for concepts over trivia |
| L5 | Low | `defuse()` in `prompts.ts` NFKC-folds the whole passage when it finds a disguised tag, so the model sees "108" for "10⁸" in that passage. Grounding still catches it. Security will narrow the fold in its next pass |
| L6 | Low | "Gram-\nnegative" across a line end is re-joined without its hyphen (unchanged from before) |
| L7 | Cosmetic | Science glyphs come from a fallback font (different look); a long equation can wrap at `=` |

## Regression on earlier features
Steps 1 and 2 e2e (subjects, notes, uploads, access control, flashcards from notes, review and FSRS grading, undo, mindmap, read-aloud, 375 px, dark mode with reduced motion) passed in every run. Unit tests for FSRS intervals, due-today and time zones are unchanged and green. Daily limit: the "goes run out" journey confirms 15 goes, the tries cap is 45, and `ai_usage_reserve` takes both from the server (no limit is hard-coded in SQL).
