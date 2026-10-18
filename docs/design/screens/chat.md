# Screen: Ask your notes (`/subjects/[id]/ask`)

Step 3. A chat that answers **only from this subject's notes and lecture files**, with numbered citations that open the exact passage. It feels like asking a study buddy who has your notebook open: warm, short answers, always showing where the answer came from, and honest when the notes don't say.

Widths: **phone** < 640 px (designed at 375), **tablet** 640–899, **laptop** ≥ 900.

## Data the screen needs
- Subject `name`, `colour`, `emoji`; counts of notes and ready files (for the intro line and empty state).
- `chat_messages` for the subject, oldest first, last 50 (older on demand): `role` (`user` / `assistant`), `content`, `citations_json` = `[{ n, chunkId, noteId|null, sourceId|null, label ("Lecture 3.pdf, page 12"), quote }]`, `kind` (`answer` / `not_covered`), `created_at`.
- Quota for kind `chat` (**20 questions per student per day**, PLAN section 4; tries cap 60) + app allowance flag.
- Whether retrieval is in keyword mode (embeddings unavailable) for the hint below.
- Up to 4 starter suggestions (server-built from names, no AI): open weak topics ("Explain Krebs cycle simply"), recent note or file titles ("What are the key points of Cell structure?"), then the fixed fallback "Quiz me with one question". Never suggestions the notes can't answer (e.g. "What will be on the exam?").

## Answering rules the developer must match
- **Retrieval:** embed the question (Edge Function `embed`, `gte-small`), top 6 chunks by cosine similarity filtered to this subject and user. If embeddings are unavailable: keyword search (Postgres full-text) over the subject's chunks, top 6.
- **Not covered without AI:** if the best similarity is under the threshold (developer tunes it, suggested 0.75 for gte-small) or keyword search finds nothing, answer with the **not-covered** message (below) without calling the model. **This does not use a question** from the daily 20 (nothing was spent).
- **Model:** `openai/gpt-oss-120b` through `runAiTask()` (quota reserved first, refunded on failure), Cloudflare fallback as for the other tasks. Passages go in as numbered refs (`p1`…`p6`) inside data blocks; the question is data too. Last 4 messages of history are included for follow-ups ("what about the second one?"), never more.
- **Grounding:** the model must answer only from the passages and mark every sentence with at least one ref (`[p2]`). The server maps refs to the student's chunk ids and renumbers them 1, 2, 3 in order of first use. Refs that weren't sent are removed; sentences left with no citation are dropped. If no cited sentence remains, or the model says the passages don't cover it, the reply becomes the not-covered message (the go is still used, because the model ran).
- **Length:** answers up to about 150 words, plain short paragraphs or a short list (bold and lists only; no headings, tables, links or images from the model). Rendered as text with a tiny safe Markdown subset; never raw HTML.
- **Never** general knowledge, opinions, exam predictions or web facts. "Quiz me with one question" is answered as a single question from the passages, with the answer hidden behind "Show answer".
- **No streaming**: the whole answer is validated before it's shown (accuracy over speed; Groq replies in a few seconds). A typing indicator covers the wait.
- Question: 1–500 characters (zod). Empty or whitespace: the Send button stays disabled.

## Layout
**Header** (compact): "← Biology", subject chip, title "Ask your notes" (Permanent Marker, 28 px; 20 px on phone), sub-line in `--ink-soft`: "Answers come only from your 4 notes and 2 files." Right side: "⋯" menu with "Clear chat" (confirm: "Clear this chat? Your notes stay as they are." → `tear`).

**Message list:** fills the space between header and composer, scrolls; max width 760 px centred on laptop. Graph-paper background shows through.
- **Student message:** right-aligned sticker, `--highlight` fill, `--on-colour` text, 2.5 px ink outline, 3 px offset shadow, max 85 % width (75 % ≥ 640 px), radius 8 with the bottom-right corner 2 px (speech-tail feel without a tail graphic).
- **Answer:** left-aligned `--card` sticker, ink outline, 4 px offset shadow, 6 px left band `--subject`, max 92 % width (80 % ≥ 640 px), 16 px text, 1.55 line height, max 65ch. Small subject emoji avatar (24 px, `aria-hidden`) top-left outside the sticker on ≥ 640 px only.
  - **Inline citations:** each ref renders as a small chip button right after the sentence: "1", "2" (min 24 × 24 px visual, 44 px hit area via padding/`::after`, `--card` fill, ink outline 1.5 px, 12 px bold). Accessible name "Source 1: Lecture 3.pdf, page 12".
  - **Sources list** under the answer text, after a dashed divider: "Sources" label, then one row per citation: number chip, "From **Lecture 3.pdf**, page 12" / "From **Cell structure** (note)" as a link built with `passageHref()` (same tab; the chat is saved, Back returns to it with scroll kept). Source deleted: chip "Source deleted", quote still viewable.
  - **Answer actions** (row of 44 px icon buttons under the sources, labelled): "Read aloud" (read-aloud.md; reads the answer without the citation numbers), "Copy" (copies text + "Sources: …" lines; toast "Copied"), and "Not right?" which opens a small menu: "It's wrong", "It's not in my notes", "Too long" → saved as feedback on the message, toast "Thanks for telling us." (no further action in Phase 1).
- **Citation preview:** tapping a chip opens the passage without leaving the chat. Laptop/tablet: popover anchored to the chip (max 360 px wide) with the source label as heading, the passage text (the chunk, cited sentence part `<mark>`ed when the quote is found), and "Open in note" / "Open in file". Phone: bottom sheet (same component as the mindmap passage panel), 60 % height. Esc / Close returns focus to the chip.
- **Not-covered answer:** left-aligned sticker with a **dashed** ink outline, no shadow, `--card` fill, magnifying-glass icon. Copy: "Your notes don't cover that yet, so I won't guess." Second line: "Try asking about something in your notes, or add a note about it." If retrieval found loosely related passages, a third line "Closest I found:" with up to 2 source links. No sound beyond the normal arrival (it's not an error).
- **Day separators:** small centred chip "Today", "Tuesday".

**Composer** (sticky at the bottom; above the iOS home bar with `env(safe-area-inset-bottom)`; moves up with the on-screen keyboard using `100dvh` layout):
- Auto-growing `.input` textarea (1–5 lines), label "Ask a question about Biology" (visible on ≥ 640 px, placeholder-only is not enough: on phone the label is sr-only and the placeholder repeats it: "Ask about your Biology notes…").
- Send button: primary icon button (paper-plane icon, label "Send"), 44 px. Enter sends, Shift+Enter new line (on touch devices Enter makes a new line; the button sends).
- Under it, one line: quota chip `18 of 20 questions left today` (at ≤ 3 the chip shows; above that it's hidden on phone to save space and visible on ≥ 640 px) + counter "320 / 500" appearing from 80 %.
- Keyword-mode hint (only when embeddings are down): "Searching your notes by keywords today, so answers may miss a few things." in `--ink-soft` 14 px.

**Phone (375 px):** header collapses to one row ("←", emoji, "Ask your notes", "⋯"); the intro sub-line moves into the empty state. Message list uses the full width minus 12 px gutters. Composer: textarea + Send in one row, chip line below. Starter suggestions scroll horizontally as chips in the empty state only (the one place horizontal scroll is allowed, inside its own container, with visible scroll affordance and all chips reachable by Tab).

## Motion
- Sent message: slides up 8 px and fades in (200 ms). Answer: pops in (350 ms spring, scale 0.96 → 1). Under reduced motion: fade 120 ms.
- Typing indicator: a small answer sticker with three ink dots bouncing in turn (1 s loop); reduced motion / focus mode: static "Looking through your notes…" text.
- Auto-scroll to the newest message only if the student was already at the bottom; otherwise a "New answer ↓" chip appears above the composer.

## States
- **Loading history:** three message skeletons (alternating sides).
- **Empty chat, has sources:** centred sticker with tape: marker line "Ask your notes anything", sub-line "I'll answer only from your Biology notes and files, and show you where each bit came from.", then up to 4 starter suggestion chips (tap = sends it, uses a question). 
- **Empty, nothing to search** (no notes, no ready files): "Add a note or a lecture file first, then ask away." + "Back to Biology"; composer disabled with that reason as its description.
- **Sources still being read** (files `extracting`): hint above the composer "Lecture 4.pdf is still being read. Ask again in a minute to include it."
- **Waiting:** student message shown at once (sending state: 60 % opacity until saved), typing indicator below, Send disabled, textarea stays editable for the next question. Live region: "Looking through your notes."
- **Answer arrives:** `pop`; live region reads "Answer: …" followed by "2 sources." (not every citation label).
- **Daily limit used:** composer replaced by a sticker: "You've asked 20 questions today. More tomorrow! Your chat is saved." Buttons "Make a quiz" (if quiz goes are left) and "Review flashcards" (if due). `boop` only when they try to send.
- **App-wide allowance used:** same place: "Today's free AI allowance is used up. Try again tomorrow. Your notes are safe." `boop` on send.
- **AI failed / network:** the student's message stays with an inline line under it "Couldn't get an answer. This one didn't use up a question." + "Try again" (resends the same question). `boop`.
- **Offline before sending:** Send disabled, hint "You're offline. Your question will wait here." (text kept in a draft in `localStorage` per subject, try/catch).
- **Load error:** "We couldn't load this chat." + "Try again".

## Sounds
`click` on Send (the press), suggestion chips, citation chips and menu items; `pop` when an answer (or not-covered reply) arrives; `boop` for errors and limits; `tear` on Clear chat. One sound per action. Nothing while waiting. Focus mode: only `chime`; read-aloud rules apply while speaking.

## Accessibility
- Message list: `role="log"` with `aria-live="polite"` off for history and on for new messages only; each message is an `<article>` labelled "You asked" / "Answer from your notes" / "Not in your notes".
- Citations are real buttons (preview) followed by real links in the sources list, so screen-reader users can go straight to "From Lecture 3.pdf, page 12". The answer text is read with citation chips as "source 1".
- Focus stays in the textarea after sending (so the next question can be typed); a "Skip to latest answer" link is the first item in the log for keyboard users.
- Keyboard: Enter sends, Shift+Enter new line, Esc closes a citation popover or sheet, `/` focuses the composer when focus isn't in a text field.
- Contrast: student bubble `--on-colour` on `--highlight` (≥ 12:1), answer `--ink` on `--card`, chips ink on card. Dashed outline + icon + text mark not-covered, not colour.
- Composer label is programmatic on every width; the quota chip is a full sentence.
