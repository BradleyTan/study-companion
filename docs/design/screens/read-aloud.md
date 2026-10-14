# Component: Read aloud (note editor, flashcards, review, mindmap passages)

Step 2. Uses the browser's built-in voices through the Web Speech API (`speechSynthesis`). Free, unlimited, no server.

## Where it appears
- **Note editor:** "Read aloud" button in the toolbar strip (after a divider, icon + label on ≥ 640 px, icon only on phone with the label as its name). Opens the player bar.
- **Flashcards deck:** speaker icon button on each card: reads front, short pause (600 ms), then back.
- **Review session:** speaker button on the card + `R` key: reads the visible side only. Plus a toggle in the session's "⋯" menu: "Read cards automatically" (off by default, remembered in `localStorage`): reads each front when it appears and the back after the flip.
- **Mindmap passage panel:** "Read aloud" reads the passage.

## Player bar (note editor)
A slim sticker bar that slides down under the toolbar (sticky with it), 56 px tall:
`[▶ Play / ❚❚ Pause] [■ Stop] · Speed [1×▾] · Voice [Daniel (English UK)▾] · ✕`
- Phone (375 px): two rows. Row 1: Play/Pause (primary, yellow), Stop, a status line "Sentence 4 of 31", close ✕. Row 2: Speed select and Voice select, each 50 % width. All targets 44 px.
- Speed: select with 0.75×, 1× (default), 1.25×, 1.5×, 1.75×, 2× (`rate`).
- Voice: `<select>` grouped "On this device" and "Online"; voices matching the page language (`en`) listed first, then "Other languages". Online voices (`localService === false`) are labelled "(online)" and the group has a hint: "Online voices send the text to your browser's maker to be spoken." Default: the first **on-device** voice for the page language; online voices are only used if the student picks one.
- **Remembered** per device in `localStorage` key `studynest.readAloud` = `{ voiceURI, rate, autoReadCards }` (voices differ per device, so this isn't saved to the profile). If the saved voice is missing on this device, fall back to the default silently.
- Close ✕ stops reading and hides the bar; focus returns to the "Read aloud" button.

## Behaviour
- **What is read:** if text is selected, just the selection; otherwise from the sentence at the cursor (or the start, if the cursor is at the top or the editor isn't focused) to the end of the note. Headings and list items are read as their own sentences. Code blocks are skipped with "(code skipped)" announced once.
- **Sentence by sentence:** text is split with `Intl.Segmenter(lang, { granularity: "sentence" })` and spoken one `SpeechSynthesisUtterance` per sentence. This makes highlighting reliable, avoids Chrome cutting off long utterances, and makes pause/resume dependable.
- **Highlight the sentence being read** (feasible, do it): in the note editor via a Tiptap/ProseMirror decoration (not by changing the document), styled as `<mark>`: `--highlight` background, `--on-colour` text, 2 px radius. Scrolls the sentence into view only if it leaves the viewport (`block: "nearest"`, smooth unless reduced motion). On cards and passages the same mark on a wrapped span. Word-level highlighting is not attempted (`boundary` events are unreliable across browsers).
- **Pause:** cancels the current utterance and remembers the sentence index; **Play** resumes from the start of that sentence (avoids the broken `pause()` on Android). Button toggles label "Pause" / "Play" with `aria-pressed`.
- **Stop:** cancels, clears the highlight, next Play starts again from the cursor.
- **Typing while reading** stops reading (status line: "Stopped because you edited the note"). Leaving the page, closing the card or flipping it (when not in auto mode) stops it too. Only one thing reads at a time: starting a new read stops the old one.
- **Speed or voice change while reading:** applies from the next sentence.
- **Focus mode:** read aloud still works (the student asked for it); other UI sounds are skipped while speech is playing.
- **Sound off:** read aloud is speech, not a UI sound, so it works when sound effects are off. The volume slider in Settings does not apply to speech (the system volume does).

## States
- **Ready:** bar as above. Status line: "Ready" / "Reading sentence 4 of 31" (status is a polite live region but only announces start, pause, stop and finish, never every sentence, so it doesn't talk over the voice).
- **Loading voices:** `getVoices()` can be empty at first; wait for `voiceschanged` up to 1.5 s. Voice select shows "Loading voices…" disabled.
- **Browser has no Speech API** (`!("speechSynthesis" in window)`): the "Read aloud" buttons are still shown but open a small popover: "Read aloud isn't available in this browser. Try Chrome, Edge or Safari." (Rendering the button keeps the feature discoverable; it's `aria-disabled`, not hidden.)
- **API present but no voices** (common on Linux): popover "Your device has no reading voices installed. On Linux, install a speech package such as speech-dispatcher, then restart the browser."
- **Error during speech** (`onerror` other than `interrupted`/`canceled`): status "Couldn't read that sentence. Skipping…" and continue with the next; three errors in a row stop reading with "Read aloud stopped. Try another voice." `boop` once.
- **Finished:** highlight clears, status "Finished", Play restarts from the top.
- **Empty note:** Play disabled, status "Nothing to read yet".

## Sounds
`click` on Play/Pause/Stop and select changes. No other UI sounds while speech is playing (the sound provider skips them), so effects never overlap the voice.

## Keyboard and accessibility
- All controls are native buttons/selects in tab order after the toolbar. In the editor, Alt+Shift+R (Option+Shift+R on Mac) toggles Play/Pause; in review, `R`.
- The bar is a `role="region"` named "Read aloud".
- Highlight is not colour alone: it's paired with the status line ("sentence 4 of 31") and works the same in both themes because the mark uses `--on-colour` on `--highlight` (≥ 12:1).
- Screen-reader users usually have their own reader: the feature doesn't steal focus or move the caret while reading.
