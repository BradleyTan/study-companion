# Screen: Subjects home (`/subjects`)

**Layout:** top bar (logo sticker "StudyNest", Settings link, Sign out). Title "Your subjects". Grid of subject stickers: 1 column < 520 px, 2 columns < 900 px, 3 above. Each sticker: subject colour fill, big emoji, name, "3 notes · 2 files", slight rotation alternating -1°/1°. Hover lifts (-2 px, shadow grows). Last tile: dashed outline "+ New subject".

**Due today (Step 2):** a "12 cards to review today" banner sits between the title and the grid, and each subject sticker shows a "12 due" chip (`--highlight`, ink text) beside "3 notes · 2 files". Exact copy, layout and counting rule in review.md "Due-today counts elsewhere".

**Create / edit dialog:** name (required, ≤ 60 chars), colour (8 swatches as radio group), emoji (grid of 24 as radio group). Live preview sticker at the top. Buttons "Create subject" / "Cancel".

**States**
- Empty: big marker text "Your notebook is empty", sub-line "Make a subject for each course, like Biology or Contract Law.", primary "Create your first subject".
- Loading: three grey sticker skeletons.
- Error: sticker card with "We couldn't load your subjects." and "Try again".
- Created: new sticker pops in (350 ms spring), `pop` sound.

**Delete** (from subject page menu): in-dialog confirm "Delete Biology? This removes 3 notes and 2 files. This can't be undone." Danger button "Delete subject", `tear` sound. Step 4: when the subject has timetable slots or study rounds, add "Your timetable keeps its 6 classes (as 'No subject'), and your study time still counts." Slots and study sessions are kept with `subject_id = null`.
