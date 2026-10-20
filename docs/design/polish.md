# Polish pass: design audit (before the student test)

Audited on 2026-10-20 on branch `claude/polish` (main after Steps 1–4), production build in demo mode (`DEMO_MODE=1`, no `.env.local`, local AI generator). Every screen was walked as a brand-new student (empty notebook → subject → note + PDF → flashcards → review → mindmap → quiz → weak topics → chat → timer → timetable → settings → privacy) and captured at **375 px** (touch, 2×) and **1280 px**, **light and dark**. axe (WCAG 2.1 A/AA tags) was run on every page in all four combinations: **no violations**. Overflow and tap-target sizes were measured in the browser. Specs compared: `design-system.md`, `sounds.md`, `screens/*.md`.

Scope is polish only: no new features, no stack changes, nothing that costs money. Every fix below uses existing tokens, classes and components.

**Priorities:** **P1** must fix before the student test (broken at 375 px, wrong information, accessibility failure, or a first-run dead end). **P2** should fix (visible inconsistency across steps). **P3** nice to have.

Screenshots referenced below are in `docs/design/polish-shots/` (small crops only).

---

## P1: must fix before the student test

### P1-1 First run: the path "notes → flashcards → quiz → timer" is not obvious
**Screens:** subject page (empty), Flashcards / Mindmap / Quizzes / Ask your notes empty states.
**What's wrong:** a brand-new subject shows four study-tool tiles and the study strip *above* the Notes and Lecture files sections (`p1-first-run-subject.png`). On a phone the "+ Write a note" button is about two screens down. Every tile leads to an empty state whose only main action is "Back to Biology" (Mindmap's isn't even primary), so a tester who taps "Flashcards" first goes round in a circle.
**Fix:**
1. Subject page, only when `notes.length === 0 && sources.length === 0`: render a **"Start here" sticker** between the subject header and the tools row: `sticker relative flex flex-col gap-3 p-5` with `<span className="tape" aria-hidden />`.
   - Title (`font-display text-2xl`): **"Start with your notes"**
   - Body (`text-ink-soft`): **"Write a note or upload a lecture file. Then StudyNest can turn it into flashcards, a mindmap and quizzes."**
   - Actions (`flex flex-wrap gap-2`): `NewNoteButton label="Write a note"` (primary) and a plain `Button` **"Upload a file"** that scrolls to `#files-h` and focuses the file input (`click` sound).
   - A tiny step line under it (`hint`): **"1 Add notes · 2 Make flashcards · 3 Quiz yourself · 4 Start a focus round"**.
   - Hide the sticker as soon as there is one note or file.
2. While the subject has no notes and no files, the four tool tiles' sub-lines read **"Add a note first"** (same `hint` style; accessible name "Flashcards, add a note first"). Tiles stay links.
3. Unify the four "nothing to work from" empty states (Flashcards, Mindmap, Quizzes, Ask) to one pattern, `sticker relative mx-auto mt-8 flex max-w-lg flex-col items-center gap-3 p-8 text-center` + tape:
   - Title `font-display text-3xl`: Flashcards **"No flashcards yet"** · Mindmap **"Nothing to map yet"** · Quizzes **"No quizzes yet"** (currently has no title) · Ask **"Nothing to ask yet"** (currently the whole sentence is the marker title).
   - Body `text-ink-soft`: **"Add a note or a lecture file first, then we can [make cards from it / map it / quiz you on it / answer from it]."**
   - Actions: primary **"Write a note"** (creates a note, same as `NewNoteButton`) + plain **"Upload a file"** (`/subjects/[id]#files-h`). Drop "Back to Biology" (the breadcrumb already does that). Flashcards keeps "Add a card" as a third, plain action.
   - Ask your notes: hide the composer while this empty state shows (today the disabled composer repeats the same sentence underneath).
4. Next-step links at the end of each step (copy only, existing pages):
   - Review "Deck done!" and "All caught up!": add a plain **"Quiz yourself"** link to `/subjects/[id]/quizzes` after "Back to Biology".
   - Quiz results: add a plain **"Start a focus round"** button (calls the same action as the study strip's "Start focus" for this subject) after "Retake this quiz".
   - Flashcards page with 0 cards but at least one note/file: **"Make flashcards" becomes `variant="primary"`** (it is plain today, see P2-6).

### P1-2 Subject page scrolls sideways at 375 px (116 px) whenever weak topics exist
**Screen:** subject page. **Cause:** in `WeakStrip`, the `sr-only` span (position absolute) sits inside the `truncate` paragraph, which is not positioned, so it escapes the clip and lands at x = 491 px.
**Fix:** `src/components/quiz/weak-strip.tsx`: give the paragraph `relative`: `className="relative min-w-0 flex-1 truncate"`. (Alternatively move the `sr-only` span out of the `<p>`.) Re-run `expectNoHorizontalScroll` on the subject page with weak topics in the e2e.

### P1-3 Subject title breaks mid-word on phones ("BIO / LOG / Y")
**Screen:** subject page header at 375 px (`p1-subject-header-375.png`). The emoji, the title and both Edit/Delete buttons share one row, so the 36 px marker title gets about 100 px and `break-words` splits even "Biology".
**Fix (`src/components/subject-header.tsx`):**
- Title: `font-display min-w-0 flex-1 text-3xl sm:text-4xl [overflow-wrap:anywhere] hyphens-auto` (keep `break-words` off so short words never split; `anywhere` only kicks in for a single word wider than the row).
- Buttons: below 640 px replace "Edit" + "Delete" with one `RowMenu` (`label="More for Biology"`, items "Edit subject", "Delete subject" with `danger: true`); from 640 px keep the two buttons. This also keeps the red Delete away from the thumb.
- Header row: `flex flex-wrap items-center gap-3 p-4 sm:gap-4 sm:p-5`; emoji `text-4xl sm:text-5xl`.

### P1-4 Wrong quiz answer shows yellow, not coral
**Screen:** quiz question feedback (`p1-quiz-wrong-option-yellow.png`). quiz.md: the chosen wrong option fills `--danger` with ✗. Today it stays `--highlight`, because `.option:has(input:checked)` (specificity 0,2,1) beats `.option[data-state="wrong"]` (0,2,0). Right answers are unaffected only because the right option is usually not the checked one.
**Fix (`globals.css`, Step 3 block):** limit the "selected" rule to unchecked-state options:
```css
.option:not([data-state]):has(input:checked) { background: var(--highlight); color: var(--on-colour); box-shadow: 1px 1px 0 var(--shadow); }
```
Then `[data-state="right"]` and `[data-state="wrong"]` win. Check that a correct choice shows mint and a wrong choice coral, in both themes.

### P1-5 "Today" divider in chat is squashed into a 40 × 48 px box
**Screen:** Ask your notes, every conversation (`p1-chat-day-chip.png`). **Cause:** class name clash. Chat uses `.day-chip` (Step 3, a centred `chip`), and the Step 4 timetable phone day strip redefined `.day-chip` (flex column, `min-height: 48px`, 8 px radius).
**Fix:** rename the chat one: in `globals.css` replace `.day-chip { align-self: center; }` (Step 3 block) with `.chat-day { align-self: center; }`, and in the chat component use `className="chip chat-day"`. Leave the timetable `.day-chip` alone.

### P1-6 Theme choice in Settings has no visible focus ring
**Screen:** Settings → Theme (`p1-theme-no-focus-ring.png`). The radios are `sr-only` inside `label.btn`; nothing styles the label when its radio has keyboard focus (WCAG 2.4.7). All other sr-only radio groups use `.seg`, `.option` or `.day-chip`, which do.
**Fix:** make Theme a segmented control like "Week starts on": wrapper `className="seg"` with `role="radiogroup"`, labels without `btn btn-sm`. The existing `.seg > label:has(input:focus-visible)` rule then draws the ring, the selected one gets `--highlight`, and targets become 44 px. Also add a safety net for any future label-buttons:
```css
.btn:has(> input:focus-visible) { outline: 3px solid var(--focus); outline-offset: 3px; }
```

### P1-7 Landing page says flashcards, quizzes and timer are "Coming soon"
**Screen:** `/` (the first thing a tester sees before signing in). All of it is built.
**Fix (`src/app/page.tsx`):** remove the `soon` flags and the "Coming soon" chip. Update the four stickers so they match what is there:
- 🗂️ **"A folder per subject"**: "Notes and lecture slides live together, one colour per course."
- 🃏 **"Flashcards that come back"**: "Make cards from your notes, then review them right before you'd forget."
- ✅ **"Quizzes on your weak spots"**: "Anything you miss goes on your weak-topics list until you've got it."
- ⏱️ **"Focus timer and timetable"**: "Pomodoro rounds per subject, your classes, and a link for your calendar."

### P1-8 Lecture file name is cut to "le…" on laptop
**Screen:** subject page, file row at 1280 px (`p1-file-row-truncated.png`). PDF chip + status chip + "Download" + "Make flashcards" + "⋯" leave the name about 30 px.
**Fix (`src/components/uploads.tsx`, ready row):** two lines. Line 1: type chip + file name (`min-w-0 flex-1 truncate font-bold`) + size (`hint`). Line 2 (`flex flex-wrap items-center gap-2`): status chip, then actions pushed right with `ml-auto`. Use `flex-wrap` on the row and `basis-full` on line 2. Keep the existing rule (from 640 px: two actions visible + "⋯"; phone: everything in "⋯").
Also align the label with the spec: subject.md calls this action **"Open"** (opens the original in a new tab); the row says "Download" while the source page says "Open the original file". Use **"Open"** on the row.

---

## P2: should fix

### P2-1 `--subject` is not set on the subject page or note editor
**Screens:** subject page, note editor, source page, and the dialogs opened from them. The weak-topics strip band is sky blue next to the mint study strip on a mint subject, and the Make flashcards / Make a quiz previews show blue quote borders. design-system.md: a subject keeps its colour everywhere.
**Fix:** wrap the page roots with `style={subjectStyle(subject.colour)}`: `src/app/(app)/subjects/[id]/page.tsx` (outer `div`), the note editor root `div` in `src/components/note-editor.tsx`, and the source page root. The `StudyStrip` local override can then go.

### P2-2 Wrong copy: "Next cards due tomorrow" is hard-coded
**Screen:** Flashcards deck when nothing is due. After rating everything Easy, the review end says "Nothing due for 8 days. Nice." and the deck says "Next cards due tomorrow".
**Fix (`deck.tsx`):** compute from the earliest `due` of the deck with the same helper the review end screen uses: "Next card due tomorrow" / "Next card due in 8 days" / "Next card due today at 15:40".

### P2-3 Disabled "Nothing due. Practise later" button as the first action
**Screen:** Flashcards deck (phone: three stacked full-width buttons, the first one disabled and muddy in dark mode).
**Fix:** when nothing is due, replace the disabled button with a status chip: `<p className="chip chip-ready">All caught up ✓</p>` + the hint from P2-2. Action order everywhere: **Review now · N due** (primary, only when due) → **Make flashcards** (primary when nothing is due, else plain) → **Add a card** (plain).

### P2-4 Quota chip sits between buttons; action row and list don't line up
**Screens:** Flashcards, Quizzes, Weak topics, Mindmap.
**What's wrong:** "14 of 15 left today" sits between "Make flashcards" and "Add a card" and reads like a button. The action row starts at the page edge (x = 80) but the card list is centred at `max-w-[880px]` (x = 200), so the page looks misaligned at 1280 px.
**Fix:** put the `QuotaChip` straight after the button it limits, in a `flex items-center gap-2` group, then the other buttons in a separate group (`flex flex-wrap gap-3` between groups). Wrap the page header (breadcrumb, title, meta, actions) in the same `mx-auto w-full max-w-[880px]` as the list (760 px on Weak topics), so everything shares one left edge.

### P2-5 Breadcrumbs and page titles differ from step to step
| Page | Today | Make it |
|---|---|---|
| Subject | "← All subjects" | keep |
| Note editor | "← Back to Biology" + chip | **"← Biology"** + chip |
| Flashcards, Quizzes, Weak topics, Ask, Source | "← Biology" + chip | keep |
| Mindmap | "← Biology", **no chip** | add the subject chip |
| Review (subject) | chip only (and "× End" in session) | **"← Biology"** + chip on the end screens; keep "× End" during a session |
| Review (all subjects) | an "All subjects" **chip** used as a link | **"← All subjects"** link (`inline-flex min-h-11 items-center font-bold`) |
| Quiz results | "← Quizzes" | "← Quizzes" + subject chip |
| Ask (phone) | bare "←" icon | "← Biology" like the other pages |

Titles: every page `h1` is `font-display text-4xl` (phone `text-3xl`), left-aligned. Two outliers: the **source page** h1 ("lecture.pdf") uses bold body type, so make it `font-display` with the file name in a `hint` line under it ("Lecture file · 3 pages"); the **Study timer** h1 is centred, so left-align it to match (the ring can stay centred).

### P2-6 Subject page and note page show the wrong loading skeleton
Opening a subject shows `subjects/loading.tsx` ("Loading your subjects", a 3-tile grid), because `subjects/[id]/` and `notes/[noteId]/` have no `loading.tsx`.
**Fix:** add `src/app/(app)/subjects/[id]/loading.tsx` (breadcrumb `skeleton h-6 w-32`, header band `skeleton h-24`, four `skeleton h-24` tiles in `grid grid-cols-2 gap-4 sm:grid-cols-4`, two `skeleton h-40` sections), `aria-busy="true" aria-label="Loading subject"`; and `notes/[noteId]/loading.tsx` (title `skeleton h-10 w-2/3`, toolbar `skeleton h-14`, sheet `skeleton h-[50vh]`). Switch `subjects/loading.tsx` from `sticker-flat animate-pulse bg-[var(--grid)]` to the shared `.skeleton` class, so reduced motion and focus mode stop the pulse the same way everywhere.

### P2-7 Tap targets under 44 px (design-system.md: ≥ 44 px)
Measured at 375 px:
- Study strip "Add a class" link (89 × 20) and "Next: …" link: add `inline-flex min-h-11 items-center`.
- Due banner "Dismiss for today" ✕ (40 × 44): add `icon-btn` (min-width 44).
- "From **Cell structure**" source links on cards and weak topics (17 px tall): `inline-flex min-h-11 items-center` on the link, or give the whole "From …" line `min-h-11 flex items-center`.
- Settings "How to unblock" `<summary>` (22 px) and "Read how we store your notes" (25 px): `inline-flex min-h-11 items-center cursor-pointer`.
- Privacy page "← StudyNest" and "Settings" links (20 px): the same.
- Quiz results "Why?" `<summary>`: `min-h-11 inline-flex items-center`.

### P2-8 Sound coverage gaps (CLAUDE.md: every interactive control plays through `useSound()`)
- **Note rows** on the subject page: the link plays nothing. sounds.md says `flip` on opening a note (subject stickers already do this). Add `onClick={() => play("flip")}` in `note-row.tsx`.
- **Mindmap outline** expand/collapse button: add `play("click")` in `outline.tsx`.
- **Timetable** "Next class: …" jump button (`timetable-screen.tsx`, the "Nothing this week" line): use `Button size="sm"` (plays `click`) instead of a raw `<button>`.
- **"← All subjects"** in the subject header and the "← Biology" links on the note editor: add `play("click")` like the other breadcrumbs.
- Nothing plays twice: checked against "one sound per action".

### P2-9 Mindmap is unreadable on a phone
**Screen:** Mindmap at 375 px (`p2-mindmap-phone-tiny.png`). `fitView` fits the whole tree into the width, so node text renders at about 5 px, and the top third of the frame is empty.
**Fix (`mindmap-canvas.tsx`):** below 640 px call `fitView({ padding: "24px", minZoom: 0.7 })` and then `setCenter` on the root node, so the root and level-1 topics are readable and the student pans to explore. Keep the existing one-time hint ("Pinch to zoom, drag to move around…"). Under the Map | Outline toggle on phones, add a `hint` line: **"Tip: Outline is easier to read on a phone."** (mindmap.md "375 px phone specifics" already asks for Outline to be offered prominently.)

### P2-10 Timetable empty state covers the hour labels on a phone
**Screen:** Timetable, empty week, 375 px (`p2-timetable-empty-covers-hours.png`). `.tt-empty` is inset 8 px from the left, so it hides 11:00–16:00, and the "Now" pill sits on the "11:00" label.
**Fix (`globals.css`):** start the overlay after the hour column (40 px on phones, 48 px from 640 px, as passed to `WeekGrid` as `hourCol`): `.tt-empty { inset: 46px 8px 8px 48px; }` and `@media (min-width: 640px) { .tt-empty { left: 56px; } }`. (`--hourcol` is set on `.tt-scroll`, not on the frame where the overlay lives, so it can't be used here unless the developer moves the variable up to `.tt-frame`, which is also fine.) The hour labels then stay visible around the sticker.

### P2-11 Hard-coded colours (CLAUDE.md: no hard-coded colours)
- `src/components/settings-form.tsx:98`: `border-[#d6453a]` on the Delete account card.
- `globals.css` `.input[aria-invalid="true"] { border-color: #d6453a }`.
**Fix:** add one token to both themes, `--danger-line: #c23a30` (light, 5.0:1 on `--card`) and `--danger-line: #ff8a7a` (dark, 6.9:1 on `--card`), add it to design-system.md's table ("outline of a danger card / invalid input; never text fill"), and use `border-[var(--danger-line)]` / `border-color: var(--danger-line)`. Also tidy `.error-text`, which sets `color` twice (remove `color: var(--ink);`).

### P2-12 "Best 0/9" reads as a score of shame
**Screens:** subject page Quizzes tile, Quizzes shelf meta line and quiz card.
**Fix (copy):** when the best score is 0, show **"Tried once · have another go"** (tile sub-line and card chip) instead of "Best 0/9". From 1 correct up, keep "Best 3/9". Accessible names follow the same text.

---

## P3: nice to have

1. **Two toast styles.** `useToast` ("Saved") is a mint `chip`; `useActionToast` ("Card deleted · Undo") is a white `sticker`. Use the sticker look for both (`sticker pop-in px-4 py-2 font-bold`), with a ✓ in front of "Saved".
2. **Disabled primary in dark mode** looks olive with a grey outline (`opacity: .55` over dark paper), e.g. "Check", Send. Replace the opacity rule with `.btn:disabled { opacity: 1; background: color-mix(in srgb, var(--card) 70%, var(--grid)); color: var(--ink-soft); border-style: dashed; box-shadow: none; }`, so it reads as "not yet" in both themes.
3. **Tile rotation pattern.** Study tools rotate 1°, −1°, −1°, 1°; on the four-across row two neighbours lean the same way. Use `i % 2 ? "-1deg" : "1deg"` across the four, then Review −1°.
4. **Timer page steppers** (− 25 min +) use ghost buttons with no outline, while Settings uses outlined steppers. Use the outlined (`plain`) variant on `/timer` too.
5. **Timetable phone:** the selected day shows twice (day strip chip and the column head "Tue 20"). Hide `.tt-dayhead` on phones (the strip already says it), giving the grid 44 px more.
6. **Upload error copy:** "The upload failed. Check your connection and try again." → **"That upload didn't go through. Check your connection and try again."** Server fallbacks "Upload failed." (`sources.ts`) → **"That upload didn't go through. Try again."**
7. **Subject page empty notes box** is `sticker-flat` (no shadow) next to the dashed drop zone. Once P1-1 adds the Start-here sticker, make the empty notes box dashed like the drop zone (`border-dashed`, no shadow), so the two "add something here" areas match.
8. **Settings Theme copy:** spec says "System / Light / Dark", the app says "Match my device / Light / Dark". The app's wording is friendlier, so update settings.md to match.

---

## Checked and fine (no change)
- **Contrast:** axe WCAG 2.1 AA, zero violations on all 17 pages × {375, 1280} × {light, dark}. Subject fills, grade buttons, chips and option states all carry `--on-colour`.
- **Reduced motion and focus mode:** tile rotation, lifts and loops stop while a focus round runs (checked on the subject page during a round); ✓/✗ badges and text still show.
- **Header:** active page underline, timer chip states, phone "⋯" menu and Timetable icon all have labels and 44 px targets.
- **Microcopy tone:** feedback headings ("Not this time. Now you know!", "Good practice.", "You know this stuff!", "Your week is wide open") match the warm voice; no "Wrong!", no blame. The only fixes are P2-12 and P3-6.
- **Dark mode:** every screen renders with an explicit paper background, readable ink and visible outlines.

## What the developer must match exactly
1. The P1-4 selector `.option:not([data-state]):has(input:checked)`; right = mint ✓, wrong = coral ✗.
2. The class rename `.day-chip` → `.chat-day` (chat only).
3. The `relative` on the weak-strip paragraph; no horizontal scroll at 375 px on any page.
4. Subject header at 375 px: the title never splits a short word; Edit/Delete go into the "More for {subject}" menu below 640 px.
5. The Start-here sticker copy and its show/hide rule (no notes and no files), plus the empty-state copy and actions in P1-1.3.
6. The new `--danger-line` token values in both themes, documented in design-system.md.
7. `--subject` is set on the subject page, note editor and source page roots.
8. Every control listed in P2-8 plays its sound through `useSound()`.
